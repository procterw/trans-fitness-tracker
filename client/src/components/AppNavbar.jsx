import React, { useEffect, useMemo, useRef, useState } from "react";

function getUserLabel(user) {
  if (!user) return "";
  const fullName = String(user.user_metadata?.full_name || "").trim();
  if (fullName) return fullName;
  const email = String(user.email || "").trim();
  if (email) return email;
  return "Google user";
}

function getAvatarText(userLabel) {
  const trimmed = String(userLabel || "").trim();
  if (!trimmed) return "?";
  const first = trimmed[0];
  return first.toUpperCase();
}

export default function AppNavbar({
  title,
  authEnabled,
  authSession,
  authStatus,
  authActionLoading,
  onSignIn,
  onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const user = authSession?.user ?? null;

  const userLabel = useMemo(() => getUserLabel(user), [user]);
  const userEmail = user?.email ? String(user.email) : "";
  const avatarText = useMemo(() => getAvatarText(userLabel), [userLabel]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocumentClick = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  return (
    <header className="appNavbar">
      <div className="appNavbarMain">
        <div className="appNavbarTitle">{title}</div>
      </div>

      <div className="appNavbarSide appNavbarSideRight">
        <div ref={menuRef} className="accountMenu">
          <button
            ref={triggerRef}
            type="button"
            className="accountMenuTrigger"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="accountAvatar" aria-hidden="true">
              {avatarText}
            </span>
          </button>

          {menuOpen ? (
            <div className="accountMenuDropdown" role="menu">
              {authStatus ? <p className="accountMenuStatus muted">{authStatus}</p> : null}

              {user ? (
                <>
                  <div className="accountMenuLabel">Signed in as</div>
                  <div className="accountMenuUser" title={userEmail || userLabel}>
                    {userLabel}
                  </div>
                  {userEmail && userEmail !== userLabel ? (
                    <div className="accountMenuSubtle muted" title={userEmail}>
                      {userEmail}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="secondary small accountMenuAction"
                    disabled={authActionLoading}
                    onClick={async () => {
                      setMenuOpen(false);
                      await onSignOut();
                    }}
                  >
                    Log out
                  </button>
                </>
              ) : authEnabled ? (
                <>
                  <p className="accountMenuSubtle muted">Not signed in.</p>
                  <button
                    type="button"
                    className="small accountMenuAction"
                    disabled={authActionLoading}
                    onClick={async () => {
                      setMenuOpen(false);
                      await onSignIn();
                    }}
                  >
                    Sign in with Google
                  </button>
                </>
              ) : (
                <p className="accountMenuSubtle muted">Auth is disabled in this environment.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
