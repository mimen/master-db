// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"

const mockSignIn = vi.fn()

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: vi.fn() }),
}))

import { SignInScreen } from "./SignInScreen"

describe("SignInScreen", () => {
  test("renders the Google sign-in button", () => {
    render(<SignInScreen />)
    expect(
      screen.getByRole("button", { name: /sign in with google/i }),
    ).toBeInTheDocument()
  })

  test("clicking the button calls signIn('google')", async () => {
    mockSignIn.mockClear()
    render(<SignInScreen />)
    await userEvent.click(
      screen.getByRole("button", { name: /sign in with google/i }),
    )
    expect(mockSignIn).toHaveBeenCalledWith("google")
  })
})
