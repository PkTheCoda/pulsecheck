import { useEffect } from "react";

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · PulseCheck` : "PulseCheck";
    return () => { document.title = "PulseCheck"; };
  }, [title]);
}
