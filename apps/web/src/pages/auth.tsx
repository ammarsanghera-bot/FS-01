import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, registerSchema } from "@marketplace/shared";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { usePageTitle } from "../components/chrome";
import { Button, Field, controlClass } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useSession, type SessionUser } from "../stores/session";

export function LoginPage() {
  usePageTitle("Sign in");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setAuth = useSession((state) => state.setAuth);
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const [server, setServer] = useState("");

  async function submit(values: z.infer<typeof loginSchema>) {
    setServer("");
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify(values) });
      setAuth(result.data.accessToken, result.data.user);
      await queryClient.invalidateQueries();
      const next = params.get("next") || homeFor(result.data.user.role);
      navigate(next);
    } catch (error) {
      setServer(error instanceof ApiError ? error.message : "Could not sign in");
    }
  }

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      <h1 className="font-display text-4xl">Sign in</h1>
      <Field label="Email" error={form.formState.errors.email?.message}>
        <input className={controlClass} type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" error={form.formState.errors.password?.message}>
        <input className={controlClass} type="password" autoComplete="current-password" {...form.register("password")} />
      </Field>
      {server ? <p className="text-sm text-[#8d3a32]">{server}</p> : null}
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Sign in</Button>
      <p className="text-sm text-muted"><Link to="/forgot-password">Forgot password</Link> · <Link to="/register">Create an account</Link></p>
    </form>
  );
}

export function RegisterPage() {
  usePageTitle("Create account");
  const [params] = useSearchParams();
  const role = params.get("role") === "VENDOR" ? "VENDOR" : "CUSTOMER";
  const navigate = useNavigate();
  const setAuth = useSession((state) => state.setAuth);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", firstName: "", lastName: "", role, storeName: "", storeDescription: "", city: "", region: "", country: "US" },
  });
  const [server, setServer] = useState("");
  const watchedRole = form.watch("role");

  async function submit(values: z.infer<typeof registerSchema>) {
    setServer("");
    try {
      const result = await api<{ accessToken: string; user: SessionUser }>("/auth/register", { method: "POST", body: JSON.stringify(values) });
      setAuth(result.data.accessToken, result.data.user);
      navigate(homeFor(result.data.user.role));
    } catch (error) {
      setServer(error instanceof ApiError ? error.message : "Could not create the account");
    }
  }

  return (
    <form className="mx-auto max-w-lg space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
      <h1 className="font-display text-4xl">{watchedRole === "VENDOR" ? "Apply to sell" : "Create an account"}</h1>
      <div className="flex gap-3 text-sm">
        <label><input type="radio" value="CUSTOMER" {...form.register("role")} /> Shop</label>
        <label><input type="radio" value="VENDOR" {...form.register("role")} /> Sell</label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="First name" error={form.formState.errors.firstName?.message}><input className={controlClass} {...form.register("firstName")} /></Field>
        <Field label="Last name" error={form.formState.errors.lastName?.message}><input className={controlClass} {...form.register("lastName")} /></Field>
      </div>
      <Field label="Email" error={form.formState.errors.email?.message}><input className={controlClass} type="email" {...form.register("email")} /></Field>
      <Field label="Password" error={form.formState.errors.password?.message}><input className={controlClass} type="password" {...form.register("password")} /></Field>
      {watchedRole === "VENDOR" ? (
        <>
          <Field label="Store name" error={form.formState.errors.storeName?.message}><input className={controlClass} {...form.register("storeName")} /></Field>
          <Field label="What do you make?" error={form.formState.errors.storeDescription?.message}><textarea className={controlClass} rows={4} {...form.register("storeDescription")} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="City"><input className={controlClass} {...form.register("city")} /></Field>
            <Field label="Region"><input className={controlClass} {...form.register("region")} /></Field>
          </div>
        </>
      ) : null}
      {server ? <p className="text-sm text-[#8d3a32]">{server}</p> : null}
      <Button type="submit" disabled={form.formState.isSubmitting}>Create account</Button>
      <p className="text-sm text-muted">A verification note is stored in the development mailbox. You can shop before you open it.</p>
    </form>
  );
}

export function ForgotPage() {
  usePageTitle("Reset password");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
    setMessage(result.message);
  }
  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={submit}>
      <h1 className="font-display text-4xl">Reset password</h1>
      <Field label="Email"><input className={controlClass} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Button type="submit">Send reset link</Button>
      {message ? <p className="text-sm text-muted">{message} In local development, open the API mailbox for the link.</p> : null}
    </form>
  );
}

export function ResetPage() {
  usePageTitle("Choose a password");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token: params.get("token"), password }) });
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset");
    }
  }
  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={submit}>
      <h1 className="font-display text-4xl">Choose a new password</h1>
      <Field label="New password"><input className={controlClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      {error ? <p className="text-sm text-[#8d3a32]">{error}</p> : null}
      <Button type="submit">Update password</Button>
    </form>
  );
}

export function VerifyPage() {
  usePageTitle("Verify email");
  const [params] = useSearchParams();
  const [message, setMessage] = useState("Confirming your email…");
  const token = params.get("token");
  useEffect(() => {
    api("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then((result) => setMessage(result.message))
      .catch((error: Error) => setMessage(error.message));
  }, [token]);
  return <p className="text-sm">{message}</p>;
}

function homeFor(role: string) {
  if (role === "ADMIN") return "/admin";
  if (role === "VENDOR") return "/vendor";
  return "/account";
}
