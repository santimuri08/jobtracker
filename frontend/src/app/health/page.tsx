"use client";
import { useEffect, useState } from "react";

export default function HealthPage() {
  const [status, setStatus] = useState<string>("loading...");

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
    fetch(`${url}/api/v1/health`)
      .then((r) => r.json())
      .then((data) => setStatus(JSON.stringify(data)))
      .catch((err) => setStatus(`error: ${err.message}`));
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Backend health check</h1>
      <pre className="mt-4 p-4 bg-gray-100 rounded">{status}</pre>
    </main>
  );
}