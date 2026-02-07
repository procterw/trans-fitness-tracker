import React from "react";

export default function SignedOutView({ authStatus, authActionLoading, onSignIn }) {
  return (
    <div className="signedOutShell">
      <section className="signedOutCard">
        <h1 className="signedOutTitle">Get fit and hot</h1>
        <p className="signedOutDescription">
          A personal health and fitness tracker for logging meals, workouts, and weekly progress with AI-assisted
          insights.
        </p>
        <div className="signedOutActions">
          <button type="button" onClick={onSignIn} disabled={authActionLoading || authStatus === "Checking session…"}>
            Sign in with Google
          </button>
        </div>
        {authStatus ? <p className="muted">{authStatus}</p> : null}
      </section>
    </div>
  );
}
