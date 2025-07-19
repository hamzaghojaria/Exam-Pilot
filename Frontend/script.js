let quizId = "";
let currentQuestions = [];
let quizSubject = "";
let quizDifficulty = "";

async function generateQuiz() {
    const btn = document.getElementById("generate-btn");
    btn.disabled = true;
    btn.innerText = "⏳ Generating...";

    const content = document.getElementById("content").value.trim();
    const questionCount = Math.min(parseInt(document.getElementById("question-count").value || "2"), 20);
    const difficulty = document.getElementById("difficulty").value;
    const subject = document.getElementById("subject").value.trim();

    quizSubject = subject;
    quizDifficulty = difficulty;

    if (!content) {
        alert("Please paste some content first.");
        btn.disabled = false;
        btn.innerText = "🚀 Generate Test";
        return;
    }

    // ✅ Clear previous result section
    document.getElementById("result-section").innerHTML = "";

    document.getElementById("quiz-section").innerHTML = `
      <div class="text-center text-gray-600 animate-pulse">Generating Test...</div>`;

    try {
        const res = await fetch("/generate-questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, count: questionCount, difficulty, subject })
        });

        const data = await res.json();
        if (data.questions && data.questions.length > 0) {
            quizId = data.quiz_id;
            currentQuestions = data.questions;
            renderQuiz(currentQuestions);
        } else {
            document.getElementById("quiz-section").innerHTML = `<p class="text-red-500">Failed to generate quiz.</p>`;
        }
    } catch (error) {
        console.error(error);
        document.getElementById("quiz-section").innerHTML = `<p class="text-red-500">Server error.</p>`;
    } finally {
        btn.disabled = false;
        btn.innerText = "🚀 Generate Test";
    }
}

function renderQuiz(questions) {
    let metadataHTML = `
      <div class="text-center text-sm text-gray-700 mb-4">
        📘 <span class="font-medium">Subject:</span> ${quizSubject || "N/A"} &nbsp; | &nbsp;
        🎯 <span class="font-medium">Difficulty:</span> ${quizDifficulty || "N/A"}
      </div>
    `;

    let html = metadataHTML;

    questions.forEach((q, idx) => {
        html += `
      <div class="bg-white p-6 rounded-xl shadow-md border relative flex justify-between items-start gap-4">
        <div class="flex-1">
          <p class="text-lg font-semibold mb-2">Q${idx + 1}. ${q.question}</p>
          <div class="space-y-2">`;

        q.options.forEach((opt, i) => {
            const label = String.fromCharCode(65 + i); // A, B, C, D
            html += `
            <div class="flex items-center space-x-2">
              <input type="radio" name="q${idx}" id="q${idx}_${label}" value="${label}" class="accent-indigo-600">
              <label for="q${idx}_${label}" class="cursor-pointer">${label}. ${opt}</label>
            </div>`;
        });

        html += `
          </div>
        </div>
        <div id="result-${idx}" class="min-w-[120px] text-right text-sm text-gray-500 pt-2">
          <!-- Result goes here -->
        </div>
      </div>`;
    });

    html += `
    <div class="text-center">
      <button onclick="submitQuiz()"
        class="mt-6 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition duration-300">
        ✅ Submit Test
      </button>
    </div>`;

    document.getElementById("quiz-section").innerHTML = html;
    document.getElementById("result-section").innerHTML = "";
}

async function submitQuiz() {
    const answers = {};
    currentQuestions.forEach((_, idx) => {
        const selected = document.querySelector(`input[name="q${idx}"]:checked`);
        answers[idx] = selected ? selected.value : "";
    });

    try {
        const res = await fetch("/check-answers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quiz_id: quizId, answers })
        });

        const data = await res.json();
        if (data.result) {
            showResults(data.result);
        }
    } catch (error) {
        console.error(error);
        document.getElementById("result-section").innerText = "Error checking answers.";
    }
}

function showResults(results) {
    let correctCount = 0;

    results.forEach((res, idx) => {
        const container = document.getElementById(`result-${idx}`);
        if (container) {
            container.innerHTML = `
              <p class="text-sm">Your Answer: <b>${res.your_answer || "—"}</b></p>
              <p class="text-sm">Correct Answer: <b>${res.correct_answer}</b></p>
              <p class="${res.is_correct ? 'text-green-600' : 'text-red-500'} font-bold">
                ${res.is_correct ? '✅ Correct' : '❌ Wrong'}
              </p>`;
        }
        if (res.is_correct) correctCount++;
    });

    const total = results.length;
    const scoreHTML = `
      <div class="bg-white border border-indigo-300 rounded-xl p-4 shadow-md text-center">
        <h2 class="text-xl font-bold text-indigo-700">🎯 Your Score</h2>
        <p class="text-3xl font-extrabold mt-2">${correctCount} / ${total}</p>
        <button onclick="retakeQuiz()"
          class="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-300">
          🔁 Retake Test
        </button>
      </div>
    `;

    document.getElementById("result-section").innerHTML = scoreHTML;
}

function retakeQuiz() {
    // Clear selected answers
    currentQuestions.forEach((_, idx) => {
        const options = document.querySelectorAll(`input[name="q${idx}"]`);
        options.forEach(opt => opt.checked = false);
        const resultDiv = document.getElementById(`result-${idx}`);
        if (resultDiv) resultDiv.innerHTML = ""; // Clear per-question result
    });

    // Clear score section
    document.getElementById("result-section").innerHTML = "";
}
