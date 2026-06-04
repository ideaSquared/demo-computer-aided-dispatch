import { Badge, Button, StatusDot } from '@cad/lib.ui';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import * as styles from './App.css.js';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { LoginPage } from './auth/LoginPage.js';
import type { Session } from './auth/session.js';
import { FleetPanel } from './fleet/FleetPanel.js';
import { useFleet } from './fleet/useFleet.js';
import { IncidentBoard } from './incidents/IncidentBoard.js';
import { useIncidents } from './incidents/useIncidents.js';
import { IncidentMap } from './map/IncidentMap.js';
import { type Identity, identityFromSession, wsUrlFor } from './presence/identity.js';
import { PresenceView } from './presence/PresencePage.js';
import { useWs } from './ws/useWs.js';

type Tab = 'incidents' | 'map' | 'fleet' | 'presence';

const TIER_TO_BADGE: Record<Identity['tier'], 'police' | 'medical' | 'fire'> = {
  police: 'police',
  medical: 'medical',
  fire: 'fire',
};

export function App() {
  return (
    <AuthProvider>
      <Gate />
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
  const [tab, setTab] = useState<Tab>('incidents');
  const { logout, switchOperator } = useAuth();

  const incidents = useIncidents({ subscribe });
  const fleet = useFleet({ subscribe });

  return (
    <div className={styles.shell}>
      <StatusStrip
        identity={identity}
        session={session}
        status={status}
        onLogout={logout}
        onSwitch={switchOperator}
      />
      <SidebarRail active={tab} onChange={setTab} />
      <div className={styles.main}>
        <div className={styles.mainContent}>
          {tab === 'incidents' ? (
            <IncidentBoard identity={identity} incidents={incidents} fleet={fleet} />
          ) : tab === 'map' ? (
            <IncidentMap identity={identity} incidents={incidents} fleet={fleet} />
          ) : tab === 'fleet' ? (
            <FleetPanel identity={identity} fleet={fleet} />
          ) : (
            <PresenceView status={status} subscribe={subscribe} send={send} />
          )}
        </div>
      </div>
    </div>
  );
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

const RAIL_ITEMS: ReadonlyArray<{ id: Tab; label: string; icon: ReactElement }> = [
  {
    id: 'incidents',
    label: 'incidents',
    icon: <IconIncidents />,
  },
  {
    id: 'map',
    label: 'map',
    icon: <IconMap />,
  },
  {
    id: 'fleet',
    label: 'fleet',
    icon: <IconFleet />,
  },
  {
    id: 'presence',
    label: 'presence',
    icon: <IconPresence />,
  },
];

function SidebarRail({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className={styles.rail} aria-label="primary">
      {RAIL_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === active ? 'page' : undefined}
          className={styles.railItem({ active: item.id === active })}
          onClick={() => onChange(item.id)}
        >
          <span className={styles.railIcon} aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
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

export type { Identity };
