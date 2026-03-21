import { BrowserRouter, Route, Routes } from "react-router-dom";
import TeacherBuilderPage from "./Pages/TeacherBuilderPage";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<TeacherBuilderPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
