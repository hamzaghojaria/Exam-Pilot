let quizId = "";
let currentQuestions = [];
let quizSubject = "";
let quizDifficulty = "";


// Generate quiz questions based on user input
async function generateQuiz() {
  const btn = document.getElementById("generate-btn");
  btn.disabled = true;
  btn.innerText = "⏳ Generating...";
  const quizSection = document.getElementById("quiz-section");

  const content = document.getElementById("content").value.trim();
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  document.getElementById("word-count-display").innerText = `${wordCount} words`;

  const questionCountInput = document.getElementById("question-count");
  const suggestedCount = Math.min(20, Math.max(1, Math.floor(wordCount / 70)));
  if (!questionCountInput.dataset.userChanged) {
    questionCountInput.value = suggestedCount;
  }

  const finalCount = parseInt(questionCountInput.value || "2");
  const difficulty = document.getElementById("difficulty").value;
  const subject = document.getElementById("subject").value.trim();

  quizSubject = subject;
  quizDifficulty = difficulty;

  if (!content) {
    alert("Please paste some content first.");
    resetGenerateButton(btn);
    return;
  }

  document.getElementById("result-section").innerHTML = "";
  quizSection.innerHTML = `<div class="text-center text-gray-600 animate-pulse">⏳ Preparing...</div>`;

  let attempts = 0;
  let success = false;

  while (attempts < 3 && !success) {
    attempts++;
    quizSection.innerHTML = "";
    try {
      const res = await fetch("/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, count: finalCount, difficulty, subject })
      });

      const data = await res.json();
      if (data.questions && data.questions.length > 0) {
        quizId = data.quiz_id;
        currentQuestions = data.questions;
        renderQuiz(currentQuestions);
        success = true;
      }
    } catch (error) {
      console.error(`❌ Attempt ${attempts} failed`, error);
    }
  }

  if (!success) {
    quizSection.innerHTML = `<p class="text-red-500 text-center">❌ Failed to generate quiz after 3 attempts.</p>`;
  }

  resetGenerateButton(btn);
}



function resetGenerateButton(btn) {
  btn.disabled = false;
  btn.innerText = "🚀 Generate Test";
}



// Render the quiz questions dynamically
function renderQuiz(questions) {
  let html = `
    <div class="text-center text-sm text-gray-700 mb-4">
      📘 <span class="font-medium">Subject:</span> ${quizSubject || "N/A"} &nbsp; | &nbsp;
      🎯 <span class="font-medium">Difficulty:</span> ${quizDifficulty || "N/A"}
    </div>`;

  questions.forEach((q, idx) => {
    html += `
      <div id="question-card-${idx}" class="bg-white p-6 rounded-xl shadow-md border space-y-4">
        <p class="text-lg font-semibold mb-2">Q${idx + 1}. ${q.question}</p>
        <div class="space-y-2">`;

    q.options.forEach((opt, i) => {
      const label = String.fromCharCode(65 + i);
      html += `
        <div class="flex items-center space-x-2">
          <input type="radio" name="q${idx}" id="q${idx}_${label}" value="${label}" class="accent-indigo-600">
          <label for="q${idx}_${label}" class="cursor-pointer">${label}. ${opt}</label>
        </div>`;
    });

    html += `
        </div>
        <div id="result-${idx}" class="text-sm text-gray-600"></div>
        <div id="explanation-wrap-${idx}" class="text-sm text-gray-800"></div>
      </div>`;
  });

  html += `
    <div class="text-center">
      <button id="submit-btn" onclick="submitQuiz()"
        class="mt-6 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition duration-300">
        ✅ Submit Test
      </button>
    </div>`;

  document.getElementById("quiz-section").innerHTML = html;
  document.getElementById("result-section").innerHTML = "";
}



// Submit quiz answers and display results
async function submitQuiz() {
  // Trigger confetti 🎉
  confetti({
    particleCount: 150,
    spread: 80,
    origin: { y: 0.6 }
  });

  const answers = {};
  currentQuestions.forEach((_, idx) => {
    const selected = document.querySelector(`input[name="q${idx}"]:checked`);
    answers[idx] = selected ? selected.value : "";
  });

  const submitButton = document.getElementById("submit-btn");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerText = "🔒 Submitted";
    submitButton.classList.add("bg-gray-400", "cursor-not-allowed");
  }

  currentQuestions.forEach((_, idx) => {
    document.querySelectorAll(`input[name="q${idx}"]`).forEach(opt => opt.disabled = true);
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


// Display results and explanations
function showResults(results) {
  let correctCount = 0;

  results.forEach((res, idx) => {
    const card = document.getElementById(`question-card-${idx}`);
    const resultContainer = document.getElementById(`result-${idx}`);
    const explanationContainer = document.getElementById(`explanation-wrap-${idx}`);

    card.classList.remove("bg-white");
    card.classList.add(res.is_correct ? "bg-green-50" : "bg-red-50");

    resultContainer.innerHTML = `
      <p>Your Answer: <b>${res.your_answer || "—"}</b></p>
      <p>Correct Answer: <b>${res.correct_answer}</b></p>
      <p class="${res.is_correct ? 'text-green-600' : 'text-red-500'} font-bold">
        ${res.is_correct ? '✅ Correct' : '❌ Wrong'}
      </p>`;

    if (!res.is_correct && res.explanation) {
      explanationContainer.innerHTML = `
        <div class="bg-blue-50 border border-blue-200 p-3 rounded-md shadow-sm mt-2">
          📝 <b>Explanation:</b> ${res.explanation}
        </div>`;
    }

    const correctInput = document.getElementById(`q${idx}_${res.correct_answer}`);
    if (correctInput?.nextElementSibling) {
      correctInput.nextElementSibling.classList.add("bg-green-100", "px-2", "py-1", "rounded");
    }

    if (res.is_correct) correctCount++;
  });

  const total = results.length;
  const percentage = Math.round((correctCount / total) * 100);

  document.getElementById("result-section").innerHTML = `
    <div class="bg-white border border-indigo-300 rounded-xl p-4 shadow-md text-center mt-8">
      <h2 class="text-xl font-bold text-indigo-700">🎯 Your Test Score</h2>
      <p class="text-3xl font-extrabold mt-2">${correctCount} / ${total}</p>
      <p class="text-lg font-medium text-gray-700 mt-1">
        📊 Percentage: <span class="text-indigo-600 font-semibold">${percentage}%</span>
      </p>
      <button onclick="retakeQuiz()"
        class="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-300">
        🔁 Retake Test
      </button>
    </div>`;
}


//// Reset quiz for retake
function retakeQuiz() {
  currentQuestions.forEach((_, idx) => {
    document.querySelectorAll(`input[name="q${idx}"]`).forEach(opt => {
      opt.checked = false;
      opt.disabled = false;
    });

    const resultDiv = document.getElementById(`result-${idx}`);
    if (resultDiv) resultDiv.innerHTML = "";

    const expDiv = document.getElementById(`explanation-wrap-${idx}`);
    if (expDiv) expDiv.innerHTML = "";

    const card = document.getElementById(`question-card-${idx}`);
    if (card) {
      card.classList.remove("bg-green-50", "bg-red-50");
      card.classList.add("bg-white");
    }

    document.querySelectorAll(`input[name="q${idx}"] + label`).forEach(label => {
      label.classList.remove("bg-green-100", "px-2", "py-1", "rounded");
    });
  });

  document.getElementById("result-section").innerHTML = "";

  const submitButton = document.getElementById("submit-btn");
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.innerText = "✅ Submit Test";
    submitButton.classList.remove("bg-gray-400", "cursor-not-allowed");
    submitButton.classList.add("bg-green-600", "hover:bg-green-700");
  }
}



// Handle live input changes
window.addEventListener("DOMContentLoaded", () => {
  const contentBox = document.getElementById("content");
  const wordCountDisplay = document.getElementById("word-count-display");
  const questionCountInput = document.getElementById("question-count");
  const generateBtn = document.getElementById("generate-btn");

  contentBox.addEventListener("input", () => {
    const text = contentBox.value.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    wordCountDisplay.innerText = `${wordCount} words`;

    if (wordCount < 300) {
      generateBtn.disabled = true;
      generateBtn.innerText = "⚠️ Enter at least 300 words";
    } else {
      generateBtn.disabled = false;
      generateBtn.innerText = "🚀 Generate Test";
    }

    const suggested = Math.min(20, Math.max(1, Math.floor(wordCount / 70)));
    if (!questionCountInput.dataset.userChanged) {
      questionCountInput.value = suggested;
    }
  });

  questionCountInput.addEventListener("input", () => {
    questionCountInput.dataset.userChanged = "true";
  });
});
