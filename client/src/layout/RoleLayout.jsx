import { LayoutDashboard, LogOut } from "lucide-react";
import "./RoleLayout.css";

const DEFAULT_NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
];

/**
 * Minimal sidebar+topbar shell shared by Instructor and Admin.
 * `themeClass` (e.g. "theme-instructor" / "theme-admin") swaps the accent
 * color via CSS variable overrides defined in RoleLayout.css — no need to
 * duplicate the layout markup or styles per role.
 */
function RoleLayout({
  themeClass,
  brandName,
  userId,
  userName,
  onSignOut,
  navItems = DEFAULT_NAV_ITEMS,
  activePage,
  onNavigate,
  children,
}) {
  return (
    <div className={`role-shell ${themeClass}`}>
      <aside className="role-sidebar">
        <div className="role-brand">
          <h1>
            <span className="role-accent">Bobby</span>
            <br />
            {brandName}
          </h1>
        </div>

        <nav className="role-nav">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activePage === id;
            return (
              <button
                key={id}
                type="button"
                className={`role-nav-item${isActive ? " active" : ""}`}
                onClick={() => onNavigate?.(id)}
              >
                <Icon size={20} strokeWidth={2} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <button type="button" className="role-signout" onClick={onSignOut}>
          <LogOut size={18} strokeWidth={2} />
          <span>Sign Out</span>
        </button>
      </aside>

      <div className="role-main">
        <header className="role-topbar">
          <div className="role-identity">
            <span className="role-id">{userId}</span>
            {userName && <span className="role-name">{userName}</span>}
          </div>
        </header>

        <main className="role-content">{children}</main>
      </div>
    </div>
  );
}

export default RoleLayout;

