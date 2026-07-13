export const isUnverifiedEmailError = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
  return message.includes("email not confirmed") || message.includes("email not verified");
};

export const authErrorMessage = (error: unknown): string => {
  if (isUnverifiedEmailError(error)) {
    return "Your email address has not been verified. Check your inbox and Spam or Junk folder for the BidBox verification email.";
  }
  const message = String((error as { message?: string })?.message ?? "");
  if (/invalid login credentials/i.test(message)) return "The email or password is incorrect.";
  if (/rate limit|too many requests/i.test(message)) return "Too many attempts. Please wait a few minutes and try again.";
  return "We couldn't sign you in. Please try again.";
};
