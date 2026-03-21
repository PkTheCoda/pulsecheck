import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import SignInPage from "./Pages/SignInPage";
import TeacherBuilderPage from "./Pages/TeacherBuilderPage";
import TeacherDashboardPage from "./Pages/TeacherDashboardPage";
import StudentQuizPage from "./Pages/StudentQuizPage";
import TeacherResponsesPage from "./Pages/TeacherResponsesPage";
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
        <Route index element={<Navigate to={user ? "/dashboard" : "/signin"} replace />} />
        <Route path="/signin" element={<SignInPage user={user} />} />
        <Route path="/builder" element={<TeacherBuilderPage user={user} />} />
        <Route path="/builder/:quizId" element={<TeacherBuilderPage user={user} />} />
        <Route path="/dashboard" element={<TeacherDashboardPage user={user} />} />
        <Route path="/dashboard/quiz/:quizId/responses" element={<TeacherResponsesPage user={user} />} />
        <Route path="/quiz/:quizId" element={<StudentQuizPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
