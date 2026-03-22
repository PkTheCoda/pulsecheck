import { Navigate, useParams } from "react-router-dom";

export default function TeacherInsightsPage({ user }) {
  const { quizId } = useParams();
  if (!user) return <Navigate to="/signin" replace />;
  return <Navigate to={`/dashboard/quiz/${quizId}/responses`} replace />;
}
