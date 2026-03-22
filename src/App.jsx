import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import SignInPage from "./Pages/SignInPage";
import TeacherBuilderPage from "./Pages/TeacherBuilderPage";
import TeacherDashboardPage from "./Pages/TeacherDashboardPage";
import StudentQuizPage from "./Pages/StudentQuizPage";
import TeacherResponsesPage from "./Pages/TeacherResponsesPage";
import TeacherInsightsPage from "./Pages/TeacherInsightsPage";
import StudyGuidePage from "./Pages/StudyGuidePage";
import Homepage from "./Pages/Homepage";
import { auth } from "./lib/firebase";


function App() {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isAuthLoading) {
    return <div className="p-6 text-sm text-slate-700">Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route index element={<Homepage user={user} />} />
        <Route path="/home" element={<Homepage user={user} />} />
        <Route path="/signin" element={<SignInPage user={user} />} />
        <Route path="/builder" element={<TeacherBuilderPage user={user} />} />
        <Route path="/builder/:quizId" element={<TeacherBuilderPage user={user} />} />
        <Route path="/dashboard" element={<TeacherDashboardPage user={user} />} />
        <Route path="/dashboard/quiz/:quizId/responses" element={<TeacherResponsesPage user={user} />} />
        <Route path="/dashboard/quiz/:quizId/insights" element={<TeacherInsightsPage user={user} />} />
        <Route path="/quiz/:quizId" element={<StudentQuizPage />} />
        <Route path="/studyguide/:quizId" element={<StudyGuidePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
