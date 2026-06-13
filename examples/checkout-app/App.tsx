import { useState } from "react";

export function App() {
  const [auth, setAuth] = useState<"guest" | "user">("guest");
  const [userId, setUserId] = useState<"none" | "u1">("none");
  const [plan, setPlan] = useState<"none" | "starter" | "pro">("none");
  const [quoteStatus, setQuoteStatus] = useState<"missing" | "loading" | "valid" | "invalid">("missing");
  const [step, setStep] = useState<"plan" | "billing" | "review" | "success">("plan");
  const [paymentMethod, setPaymentMethod] = useState<"none" | "valid">("none");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "failed">("idle");

  return (
    <main>
      <button
        disabled={auth !== "guest"}
        onClick={() => {
          setAuth("user");
          setUserId("u1");
        }}
      >
        Login
      </button>
      <button
        onClick={() => {
          setAuth("guest");
          setUserId("none");
          setStep("plan");
          setPlan("none");
          setQuoteStatus("missing");
          setPaymentMethod("none");
          setSubmitStatus("idle");
        }}
      >
        Logout
      </button>
      <button
        disabled={auth !== "user"}
        onClick={async () => {
          setPlan("pro");
          setQuoteStatus("loading");
          await api.fetchQuote({ plan: "pro" });
          setQuoteStatus("invalid");
        }}
      >
        Pro
      </button>
      <button
        disabled={auth !== "user"}
        onClick={() => {
          setPlan("starter");
          setQuoteStatus("valid");
        }}
      >
        Starter
      </button>
      <button disabled={auth !== "user" || plan === "none"} onClick={() => setStep("billing")}>Billing</button>
      <button disabled={auth !== "user" || step !== "billing"} onClick={() => setPaymentMethod("valid")}>Use card</button>
      <button disabled={auth !== "user" || step !== "billing" || paymentMethod === "none"} onClick={() => setStep("review")}>Review order</button>
      <button onClick={() => setStep("plan")}>Back to plans</button>
      <button
        disabled={auth !== "user" || step !== "review" || submitStatus === "submitting" || plan === "none"}
        onClick={async () => {
          setSubmitStatus("submitting");
          try {
            await api.submitOrder({ userId, plan });
            setSubmitStatus("idle");
            setStep("success");
          } catch {
            setSubmitStatus("failed");
          }
        }}
      >
        Submit order
      </button>
      <output>{auth}</output>
      <output>{userId}</output>
      <output>{plan}</output>
      <output>{quoteStatus}</output>
      <output>{step}</output>
      <output>{paymentMethod}</output>
      <output>{submitStatus}</output>
    </main>
  );
}
