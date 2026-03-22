# 🩺 PulseCheck
**The quiz tool that tells you what to do next.**

[**Live Demo 🚀**](https://pulsecheck-edu.vercel.app/)

PulseCheck moves beyond simple grading to identify "confidently wrong" students and class-wide misconceptions in real-time. Built for UVA's Hoohacks hackathon, it turns raw results into a clear instructional roadmap.

## 🚀 Key Features
* **AI Quiz Generation:** Instantly turn PDFs or lesson notes into tagged assessments via **Gemini 2.5 Flash**.
* **Zero-Login Portal:** Students join via a simple link—no accounts, no apps, no friction.
* **The "Class Pulse":** A proprietary readiness score (0–100) that blends accuracy, confidence calibration, and outlier detection.
* **Deep Analysis Dashboard:** Real-time feedback flagging "Toss-up" questions and students in the "Danger Zone."
* **Automated Study Guides:** One-click generation of review material tailored to the specific concepts your class struggled with most.

## 🛠️ Tech Stack
* **Frontend:** React, Vite, Tailwind CSS
* **Backend:** Firebase (Auth, Firestore, Storage)
* **AI Engine:** Google Gemini 2.5 Flash API
* **Deployment:** Vercel

## 📊 The Pulse Formula
We use a weighted algorithm to determine if a class is truly ready to move on:
$$Pulse = \text{round}(\text{clamp}(0.6 \cdot \text{accuracy} + 0.25 \cdot \text{calibration} - \text{outlierPenalty}))$$

* **Accuracy (60%):** The mean fraction of correct answers across the class.
* **Calibration (25%):** How well student confidence (1–5 scale) matches their actual performance.
* **Outlier Penalty:** A deduction of **8 points** per student falling significantly below the statistical mean to ensure no student is left behind.

## 📦 Getting Started
1.  **Clone the repo:**
    ```bash
    git clone https://github.com/your-username/pulsecheck.git
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Environment Variables:**
    Create a `.env` file with your credentials:
    ```env
    VITE_FIREBASE_API_KEY=your_key
    VITE_GEMINI_API_KEY=your_key
    ```
4.  **Launch:**
    ```bash
    npm run dev
    ```

## 🧠 The "Why"
Traditional grading is an autopsy; it tells you who failed after it's too late to fix it. PulseCheck performs a **live biopsy**. By capturing student confidence, we identify the "Confidently Wrong"—students who believe a falsehood so strongly they won't ask for help. We turn that data into your next teaching move.
