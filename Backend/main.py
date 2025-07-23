from fastapi import FastAPI, Request, Form, Response, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse,RedirectResponse
import bcrypt
import uuid
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from uuid import uuid4
import re
import asyncio
import ollama
import uvicorn
from pydantic import BaseModel, field_validator
import json
from typing import List
import ast, os 

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)



##################### Services ##################### - START
# Serve static frontend files
app.mount("/static", StaticFiles(directory="Frontend"), name="static")

# In-memory user database
user_db = {}         # email → {name, email, hashed_pw}
sessions = {}        # session_id → email

@app.get("/", response_class=HTMLResponse)
async def serve_frontend(request: Request):
    session_id = request.cookies.get("session_id")
    email = sessions.get(session_id)
    with open("Frontend/index.html", "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace("{{logged_in}}", "true" if email else "false")
    return HTMLResponse(content=html)


@app.get("/signup", response_class=HTMLResponse)
async def signup():
    with open("Frontend/signup.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/login", response_class=HTMLResponse)
async def login():
    with open("Frontend/login.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/profile", response_class=HTMLResponse)
async def profile(request: Request):
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in sessions:
        return RedirectResponse("/login", status_code=302)

    email = sessions[session_id]
    user = user_db.get(email)
    if not user:
        return RedirectResponse("/login", status_code=302)

    with open("Frontend/profile.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Replace placeholders with user data
    html = html.replace("{{name}}", user.get("name", ""))
    html = html.replace("{{email}}", user.get("email", ""))
    html = html.replace("{{college}}", user.get("college", ""))
    html = html.replace("{{standard}}", user.get("standard", ""))
    html = html.replace("{{phone}}", user.get("phone", ""))

    return HTMLResponse(content=html)

@app.post("/update_profile")
async def update_profile(
    request: Request,
    name: str = Form(...),
    college: str = Form(""),
    standard: str = Form(""),
    phone: str = Form("")
):
    session_id = request.cookies.get("session_id")
    email = sessions.get(session_id)

    if not email or email not in user_db:
        raise HTTPException(status_code=401, detail="Not logged in")

    # Update user info
    user = user_db[email]
    user["name"] = name
    user["college"] = college
    user["standard"] = standard
    user["phone"] = phone

    print( f"Updated profile for {user}")
    # Redirect to profile with success flag
    return RedirectResponse(url="/profile?updated=1", status_code=302)


@app.get("/logout")
async def logout(response: Response, request: Request):
    session_id = request.cookies.get("session_id")
    if session_id in sessions:
        del sessions[session_id]
    response = RedirectResponse("/login", status_code=302)
    response.delete_cookie("session_id")
    return response

@app.post("/register")
async def register(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    college: str = Form(""),
    standard: str = Form(""),
    phone: str = Form("")
):
    if email in user_db:
        return JSONResponse(status_code=400, content={"error": "User already exists!"})
    
    hashed_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    user_db[email] = {
        "name": name,
        "email": email,
        "password": hashed_pw,
        "college": college,
        "standard": standard,
        "phone": phone
    }
    return {"message": "Registration successful."}



@app.post("/login")
async def do_login(
    response: Response,
    email: str = Form(...),
    password: str = Form(...)
):
    user = user_db.get(email)
    if not user or not bcrypt.checkpw(password.encode(), user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session_id = str(uuid.uuid4())
    sessions[session_id] = email
    response = RedirectResponse("/", status_code=302)
    response.set_cookie("session_id", session_id, httponly=True)
    return response

@app.get("/users")
async def get_users():
    # Return full profile info except password
    return [
        {
            "name": user["name"],
            "email": user["email"],
            "college": user.get("college", ""),
            "standard": user.get("standard", ""),
            "phone": user.get("phone", "")
        }
        for user in user_db.values()
    ]
@app.get("/sessions")
async def get_sessions():
    return [
        {"session_id": sid, "email": email}
        for sid, email in sessions.items()
    ]


##################### Services ##################### - END

# In-memory quiz store
quiz_store = {}

# Ollama client
client = ollama.Client()

# Pydantic model for validation
class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    answer: str
    explanation: str = ""

    @field_validator("options")
    @classmethod
    def validate_options(cls, v):
        if len(v) != 4:
            raise ValueError("There must be exactly 4 options.")
        return v

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, v):
        if v.upper() not in ["A", "B", "C", "D"]:
            raise ValueError("Answer must be one of A, B, C, or D.")
        return v.upper()

# Async wrapper for Ollama
async def generate_with_ollama(prompt: str):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: client.generate(
        model="llama3.2:1b",
        prompt=prompt,
        options={"num_predict": 1024}
    ))



@app.post("/generate-questions")
async def generate_questions(request: Request):
    data = await request.json()
    content = data.get("content", "")
    total_required = int(data.get("count", 2))
    difficulty = data.get("difficulty", "Medium")
    subject = data.get("subject", "General Knowledge")
    total_required = min(total_required, 20)

    prompt = (
        f"Generate {total_required} multiple-choice questions on the subject '{subject}' "
        f"with a {difficulty.lower()} difficulty level, from the following content.\n\n"
        "Each question must follow this strict JSON format:\n"
        "{\n"
        "  \"question\": \"...\",\n"
        "  \"options\": [\"A. ...\", \"B. ...\", \"C. ...\", \"D. ...\"],\n"
        "  \"answer\": \"A\",\n"
        "  \"explanation\": \"Why this is the correct answer.\"\n"
        "}\n\n"
        "All questions must be returned as a single JSON array.\n"
        "⚠️ Important: Do NOT add explanations or text outside the JSON array.\n\n"
        f"Content:\n{content}"
    )

    for attempt in range(3):
        try:
            print(f"Attempt {attempt+1} to generate {total_required} questions ...")
            response = await generate_with_ollama(prompt)
            raw_output = response["response"].strip()

            # Try parsing
            try:
                questions_data = json.loads(raw_output)
                if not isinstance(questions_data, list):
                    raise ValueError("Expected a list.")
            except Exception:
                questions_data = []
                matches = re.findall(r'{[^{}]*}', raw_output)
                for m in matches:
                    try:
                        m_fixed = m.strip()
                        if not m_fixed.endswith("}"):
                            m_fixed += "}"
                        obj = ast.literal_eval(m_fixed.replace("true", "True").replace("false", "False"))
                        if isinstance(obj, dict):
                            questions_data.append(obj)
                    except:
                        continue

            all_questions = []
            for q in questions_data:
                try:
                    if "options" in q and isinstance(q["options"], list):
                        q["options"] = q["options"][:4]
                    valid_q = QuizQuestion(**q).dict()
                    all_questions.append(valid_q)
                except:
                    continue

            if all_questions:
                quiz_id = str(uuid4())
                quiz_store[quiz_id] = all_questions[:total_required]
                return JSONResponse(content={
                    "quiz_id": quiz_id,
                    "questions": [
                        {k: v for k, v in q.items() if k != "answer"}
                        for q in all_questions[:total_required]
                    ]
                })
        except Exception as e:
            print(f"Attempt {attempt+1} failed: {e}")

    return JSONResponse(status_code=500, content={"error": "Failed to generate quiz after 3 retries."})


@app.post("/check-answers")
async def check_answers(request: Request):
    data = await request.json()
    quiz_id = data.get("quiz_id")
    user_answers = data.get("answers")

    if quiz_id not in quiz_store:
        return JSONResponse(status_code=400, content={"error": "Invalid quiz ID"})

    questions = quiz_store[quiz_id]
    result = []

    for idx, q in enumerate(questions):
        correct = q["answer"].upper().strip()
        user_ans = user_answers.get(str(idx), "").upper().strip()
        result.append({
            "question": q["question"],
            "your_answer": user_ans,
            "correct_answer": correct,
            "is_correct": user_ans == correct,
            "explanation": q.get("explanation", "")
        })

    return JSONResponse(content={"result": result})

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
