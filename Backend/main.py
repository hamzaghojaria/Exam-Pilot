from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse
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

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend files
app.mount("/static", StaticFiles(directory="Frontend"), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    with open("Frontend/index.html", "r", encoding="utf-8") as f:
        return f.read()

# In-memory quiz store
quiz_store = {}

# Ollama client
client = ollama.Client()

# Pydantic model for validation
class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    answer: str

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

import ast

@app.post("/generate-questions")
async def generate_questions(request: Request):
    data = await request.json()
    content = data.get("content", "")
    total_required = int(data.get("count", 2))  # Passed from frontend
    total_required = min(total_required, 20)

    try:
        prompt = (
            f"Generate {total_required} multiple-choice questions from the following content.\n"
            "Each question must be in strict JSON format like:\n"
            "{\n"
            "  \"question\": \"...\",\n"
            "  \"options\": [\"A. ...\", \"B. ...\", \"C. ...\", \"D. ...\"],\n"
            "  \"answer\": \"A\"  // Just the correct letter\n"
            "}\n\n"
            "Wrap all questions in a single JSON array like this:\n"
            "[ {...}, {...} ]\n"
            "⚠️ Important: Do NOT add explanations or any extra text — only return raw JSON array.\n\n"
            f"Content:\n{content}"
        )

        print(f"🧠 Calling Ollama for {total_required} questions...")
        response = await generate_with_ollama(prompt)
        raw_output = response["response"].strip()
        print("=== OLLAMA RAW OUTPUT ===")
        print(repr(raw_output))

        # Try parsing as JSON array directly
        try:
            questions_data = json.loads(raw_output)
            if not isinstance(questions_data, list):
                raise ValueError("Expected a list.")
        except Exception:
            print("⚠️ Parsing failed. Trying to recover individual JSON objects...")
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
                except Exception as e:
                    print("⛔ Skipping invalid JSON object:", e)
                    continue

        all_questions = []
        for q in questions_data:
            try:
                if "options" in q and isinstance(q["options"], list):
                    q["options"] = q["options"][:4]
                valid_q = QuizQuestion(**q).dict()
                all_questions.append(valid_q)
            except Exception as e:
                print(f"❌ Skipped invalid question: {e}")
                print(f"   Data: {q}")

        quiz_id = str(uuid4())
        quiz_store[quiz_id] = all_questions[:total_required]
        print(f"✅ Final questions: {len(all_questions)}")

        return JSONResponse(content={
            "quiz_id": quiz_id,
            "questions": [{k: v for k, v in q.items() if k != "answer"} for q in all_questions[:total_required]]
        })

    except Exception as e:
        print(f"❌ Error generating quiz: {e}")
        return JSONResponse(status_code=500, content={"error": "Failed to generate quiz."})


# Check answers endpoint
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
            "is_correct": user_ans == correct
        })

    return JSONResponse(content={"result": result})

# Run the app
if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
