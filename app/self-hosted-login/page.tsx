"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function SelfHostedLoginPage() {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/self-hosted-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        // Full page redirect ensures cookie is sent with the request
        window.location.href = "/dashboard"
      } else {
        setError("Wrong password")
      }
    } catch {
      setError("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-gray-800 rounded-xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-white text-center mb-2">TaxHacker India</h1>
        <p className="text-gray-400 text-center text-sm mb-6">Enter your instance password to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Instance password"
            autoFocus
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 text-black font-semibold rounded-lg transition-colors"
          >
            {loading ? "Verifying..." : "Continue"}
          </button>
        </form>

        <p className="text-gray-500 text-xs text-center mt-6">
          Set via SELF_HOSTED_PASSWORD environment variable
        </p>
      </div>
    </div>
  )
}
