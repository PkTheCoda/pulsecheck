import { Link } from "react-router-dom";
import { FiBarChart2 } from "react-icons/fi";

export default function SiteHeader({ children }) {
  return (
    <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-600">
            <FiBarChart2 className="h-3.5 w-3.5 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-gray-900">PulseCheck</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/about" className="text-sm text-gray-500 transition-colors hover:text-gray-900">
            About
          </Link>
          {children}
        </div>
      </div>
    </nav>
  );
}
