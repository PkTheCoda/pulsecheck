import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import SignInPage from "./Pages/SignInPage";
import TeacherBuilderPage from "./Pages/TeacherBuilderPage";
import TeacherDashboardPage from "./Pages/TeacherDashboardPage";
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
      <Routes>
        <Route index element={<Navigate to={user ? "/dashboard" : "/signin"} replace />} />
        <Route path="/signin" element={<SignInPage user={user} />} />
        <Route path="/builder" element={<TeacherBuilderPage user={user} />} />
        <Route path="/dashboard" element={<TeacherDashboardPage user={user} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
