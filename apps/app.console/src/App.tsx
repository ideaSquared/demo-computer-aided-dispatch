import { Badge, Button, StatusDot } from '@cad/lib.ui';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import * as styles from './App.css.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { useAbility } from './auth/ability.js';
import { LoginPage } from './auth/LoginPage.js';
import type { Session } from './auth/session.js';
import { CallIntakePage } from './call-intake/CallIntakePage.js';
import { CrossTierOverviewPage } from './cross-tier/CrossTierOverviewPage.js';
import { DispatchQueuePage } from './dispatch-queue/DispatchQueuePage.js';
import { FleetPanel } from './fleet/FleetPanel.js';
import { useFleet } from './fleet/useFleet.js';
import { IncidentBoard } from './incidents/IncidentBoard.js';
import { useIncidents } from './incidents/useIncidents.js';
import { IncidentMap } from './map/IncidentMap.js';
import { OversightPage } from './oversight/OversightPage.js';
import { type Identity, identityFromSession, wsUrlFor } from './presence/identity.js';
import { PresenceView } from './presence/PresencePage.js';
import { defaultPathFor, type ViewDef, visibleViews } from './routing/views.js';
import { useWs } from './ws/useWs.js';

const TIER_TO_BADGE: Record<Identity['tier'], 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}

function Gate() {
  const { session, hydrating } = useAuth();
  if (hydrating) {
    return <div className={styles.loadingScreen}>restoring session…</div>;
  }
  if (!session) return <LoginPage />;
  return <ConsoleShell session={session} />;
}

function ConsoleShell({ session }: { session: Session }) {
  const identity = useMemo(() => identityFromSession(session), [session]);
  const url = wsUrlFor();
  const { status, subscribe, send } = useWs({ url });
  const { logout, switchOperator } = useAuth();
  const ability = useAbility(session);

  const incidents = useIncidents({ subscribe });
  const fleet = useFleet({ subscribe });

  const sidebar = useMemo(() => visibleViews(ability, identity), [ability, identity]);
  const defaultPath = useMemo(
    () => defaultPathFor(session.operator.roles, ability, identity),
    [session.operator.roles, ability, identity],
  );

  return (
    <div className={styles.shell}>
      <StatusStrip
        identity={identity}
        session={session}
        status={status}
        onLogout={logout}
        onSwitch={switchOperator}
      />
      <SidebarRail views={sidebar} />
      <ViewGuard sidebar={sidebar} defaultPath={defaultPath} />
      <div className={styles.main}>
        <div className={styles.mainContent}>
          <Routes>
            <Route path="/" element={<Navigate to={defaultPath} replace />} />
            <Route
              path="/call-intake"
              element={<CallIntakePage identity={identity} incidents={incidents} />}
            />
            <Route
              path="/dispatch-queue"
              element={
                <DispatchQueuePage identity={identity} incidents={incidents} fleet={fleet} />
              }
            />
            <Route
              path="/incidents"
              element={<IncidentBoard identity={identity} incidents={incidents} fleet={fleet} />}
            />
            <Route
              path="/cross-tier"
              element={<CrossTierOverviewPage identity={identity} incidents={incidents} />}
            />
            <Route
              path="/map"
              element={<IncidentMap identity={identity} incidents={incidents} fleet={fleet} />}
            />
            <Route path="/fleet" element={<FleetPanel identity={identity} fleet={fleet} />} />
            <Route
              path="/oversight"
              element={<OversightPage identity={identity} incidents={incidents} />}
            />
            <Route
              path="/presence"
              element={<PresenceView status={status} subscribe={subscribe} send={send} />}
            />
            <Route path="*" element={<Navigate to={defaultPath} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

/**
 * If the current URL points to a view this operator can't see (e.g. after a
 * dev-switch from `supervisor` to `observer` left us on `/oversight`),
 * redirect to the role's default landing. Sidebar already hides the link;
 * this closes the URL-typing / persona-swap gap.
 */
function ViewGuard({ sidebar, defaultPath }: { sidebar: readonly ViewDef[]; defaultPath: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.pathname === '/') return;
    const allowed = sidebar.some((v) => v.path === location.pathname);
    if (!allowed) navigate(defaultPath, { replace: true });
  }, [location.pathname, sidebar, defaultPath, navigate]);
  return null;
}

type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

function StatusStrip({
  identity,
  session,
  status,
  onLogout,
  onSwitch,
}: {
  identity: Identity;
  session: Session;
  status: WsStatus;
  onLogout: () => Promise<void> | void;
  onSwitch: () => void;
}) {
  const clock = useClock();
  return (
    <header className={styles.statusStrip}>
      <div className={styles.stripLeft}>
        <span className={styles.stripBrand}>{'cad // ops'}</span>
        <span className={styles.stripDivider} aria-hidden="true" />
        <Badge tone="tier" value={TIER_TO_BADGE[identity.tier]} variant="soft" size="sm">
          {identity.tier}
        </Badge>
        <span className={styles.stripDivider} aria-hidden="true" />
        <div className={styles.stripIdentity}>
          <span className={styles.stripIdentityName}>{identity.displayName}</span>
          <span>·</span>
          <span>{session.operator.roles.join(', ') || 'no roles'}</span>
          <span>·</span>
          <span>{session.operator.email}</span>
        </div>
      </div>
      <div className={styles.stripRight}>
        <time className={styles.stripClock} title="local time">
          {clock}
        </time>
        <span className={styles.stripDivider} aria-hidden="true" />
        <span className={styles.stripConnection}>
          <StatusDot
            tone="connection"
            value={status}
            pulse={status === 'connecting' || status === 'reconnecting'}
          />
          {status}
        </span>
        <span className={styles.stripDivider} aria-hidden="true" />
        <Button size="sm" intent="ghost" onClick={onSwitch}>
          switch
        </Button>
        <Button
          size="sm"
          intent="ghost"
          onClick={() => {
            void onLogout();
          }}
        >
          sign out
        </Button>
      </div>
    </header>
  );
}

function useClock(): string {
  const [now, setNow] = useState<string>(() => formatClock(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatClock(new Date())), 1_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const ICONS: Record<string, ReactElement> = {
  'call-intake': <IconCallIntake />,
  'dispatch-queue': <IconDispatch />,
  incidents: <IconIncidents />,
  'cross-tier': <IconCrossTier />,
  map: <IconMap />,
  fleet: <IconFleet />,
  oversight: <IconOversight />,
  presence: <IconPresence />,
};

function SidebarRail({ views }: { views: readonly ViewDef[] }) {
  const location = useLocation();
  return (
    <nav className={styles.rail} aria-label="primary">
      {views.map((view) => {
        const active = location.pathname === view.path;
        return (
          <NavLink
            key={view.id}
            to={view.path}
            aria-current={active ? 'page' : undefined}
            className={styles.railItem({ active })}
          >
            <span className={styles.railIcon} aria-hidden="true">
              {ICONS[view.id] ?? <IconIncidents />}
            </span>
            <span>{view.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function IconIncidents() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>incidents</title>
      <path d="M12 2l1.5 5h5l-4 3.5 1.5 5-4-3-4 3 1.5-5-4-3.5h5z" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>map</title>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}
function IconFleet() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>fleet</title>
      <rect x="3" y="11" width="13" height="7" rx="1" />
      <path d="M16 13h4l1 3v2h-5zM6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    </svg>
  );
}
function IconPresence() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>presence</title>
      <circle cx="9" cy="9" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M15 20c0-2.5 2-4.5 5-4.5" />
    </svg>
  );
}
function IconCallIntake() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>call intake</title>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7a2 2 0 0 1 1.72 2.02z" />
    </svg>
  );
}
function IconDispatch() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>dispatch queue</title>
      <path d="M3 6h18M3 12h12M3 18h18" />
      <circle cx="20" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
function IconCrossTier() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>cross-tier</title>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="16" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
function IconOversight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <title>oversight</title>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export type { Identity };
