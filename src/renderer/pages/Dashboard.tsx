import { useMemo, type JSX } from 'react';
import { useApp } from '../app/state';
import { useRoute } from '../app/router';
import { useShell } from '../app/AppShell';
import { call } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Stat, TableSkeleton, useResource } from '../components/ui';
import { Icon, type IconName } from '../components/Icons';
import { date, dateAndTime, money, moneyCompact, numerals, STATUS_LABELS, statusTone, todayKey } from '../lib/format';

interface DashboardSummary {
  date: string;
  appointments: { total: number; completed: number; no_show: number; cancelled: number; pending: number; arrived: number };
  queue: { waiting: number; in_progress: number; completed: number } | null;
  visitsToday: number;
  newPatientsToday: number;
  revenue: {
    today_poisha: number;
    month_poisha: number;
    invoiced_today_poisha: number;
    outstanding_poisha: number;
    todayPoisha: number;
  } | null;
  lowStock: number | null;
  expiringSoon: number | null;
  recentPatients: { id: number; patient_code: string; full_name: string; phone: string; created_at: string }[];
  upcoming: {
    id: number; appointment_date: string; start_time: string; appointment_type: string; status: string;
    patient_name: string; patient_code: string; dentist_name: string | null;
  }[];
  recentPayments: { id: number; payment_no: string; payment_date: string; method: string; amount_poisha: number; patient_name: string }[];
  todayAppointments: {
    id: number; appointment_date: string; start_time: string; duration_minutes: number;
    appointment_type: string; status: string;
    patient_id: number; patient_name: string; patient_code: string; dentist_name: string | null;
  }[];
  revenueTrend: { day: string; collected_poisha: number }[];
  topTreatments: { description: string; total_poisha: number }[];
}

export function DashboardPage(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const shell = useShell();

  const summary = useResource(
    () => call<DashboardSummary>('dashboard.summary'),
    [shell.refreshSignal],
  );

  const data = summary.data;
  const prefs = app.prefs;

  const trend = useMemo(() => {
    const rows = data?.revenueTrend ?? [];
    if (rows.length === 0) return null;
    const max = Math.max(...rows.map((r) => Number(r.collected_poisha)), 1);
    return { rows, max };
  }, [data]);

  const today = todayKey();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        icon="dashboard"
        title={`${greeting}, ${app.user?.displayName?.split(' ')[0] ?? 'there'}`}
        subtitle={`${date(data?.date ?? today, prefs)} · ${app.clinicName}`}
        actions={
          <>
            {app.has('patients.create') ? (
              <Button variant="primary" icon="user-plus" onClick={() => route.navigate('patients?new=1')}>
                New patient
              </Button>
            ) : null}
            {app.has('appointments.manage') ? (
              <Button icon="calendar" onClick={() => route.navigate('appointments?new=1')}>
                New appointment
              </Button>
            ) : null}
            <Button icon="refresh" aria-label="Refresh" onClick={shell.requestRefresh} />
          </>
        }
      />

      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : null}

      <div className="stat-grid">
        <Stat
          label="Appointments today"
          value={data ? Number(data.appointments.total) : '—'}
          meta={data ? `${Number(data.appointments.pending)} pending · ${Number(data.appointments.completed)} done` : undefined}
          icon="calendar"
          href="appointments"
        />
        {app.has('queue.view') ? (
          <Stat
            label="Waiting in queue"
            value={data?.queue ? Number(data.queue.waiting) : '—'}
            meta={data?.queue ? `${Number(data.queue.in_progress)} in chair` : undefined}
            icon="queue"
            tone="info"
            href="queue"
          />
        ) : null}
        <Stat
          label="Visits today"
          value={data ? data.visitsToday : '—'}
          meta={data ? `${data.newPatientsToday} new patient(s)` : undefined}
          icon="stethoscope"
        />
        {data?.revenue ? (
          <>
            <Stat
              label="Collected today"
              value={money(data.revenue.todayPoisha, prefs, { decimals: 0 })}
              meta={`${moneyCompact(data.revenue.month_poisha, prefs)} this month`}
              icon="payments"
              tone="ok"
              href="billing/payments"
            />
            <Stat
              label="Outstanding"
              value={moneyCompact(data.revenue.outstanding_poisha, prefs)}
              meta="Across all unpaid invoices"
              icon="alert-circle"
              tone={Number(data.revenue.outstanding_poisha) > 0 ? 'warn' : 'ok'}
              href="billing/invoices?status=unpaid"
            />
          </>
        ) : null}
        {app.has('inventory.view') ? (
          <Stat
            label="Stock alerts"
            value={data ? Number(data.lowStock ?? 0) + Number(data.expiringSoon ?? 0) : '—'}
            meta={data ? `${data.lowStock ?? 0} low · ${data.expiringSoon ?? 0} expiring` : undefined}
            icon="inventory"
            tone={data && Number(data.lowStock ?? 0) + Number(data.expiringSoon ?? 0) > 0 ? 'warn' : 'ok'}
            href="billing/inventory"
          />
        ) : null}
      </div>

      <div className="grid grid-2-1 mt-4">
        <Card
          title="Today's schedule"
          icon="calendar"
          subtitle={data ? `${data.todayAppointments.length} appointment(s)` : undefined}
          actions={<Button size="sm" variant="ghost" onClick={() => route.navigate('appointments')}>View all</Button>}
          flush
        >
          {summary.loading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : !data?.todayAppointments.length ? (
            <EmptyState
              icon="calendar"
              title="No appointments today"
              text="Book an appointment to see it here."
              compact
              primary={
                app.has('appointments.manage') ? (
                  <Button variant="primary" icon="plus" onClick={() => route.navigate('appointments?new=1')}>
                    New appointment
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              compact
              rows={data.todayAppointments}
              onRowClick={(row) => route.navigate(`patients/${row.patient_id}`)}
              columns={[
                {
                  key: 'time',
                  header: 'Time',
                  width: 92,
                  render: (row) => <span className="mono">{dateAndTime(row.appointment_date, row.start_time, prefs)}</span>,
                },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (row) => (
                    <div className="stack stack-0">
                      <strong className="truncate">{row.patient_name}</strong>
                      <span className="text-xs text-3 mono">{row.patient_code}</span>
                    </div>
                  ),
                },
                {
                  key: 'dentist',
                  header: 'Dentist',
                  width: 150,
                  render: (row) => <span className="truncate">{row.dentist_name ?? '—'}</span>,
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: 120,
                  render: (row) => <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
                },
              ]}
            />
          )}
        </Card>

        <Card title="Recent patients" icon="patients" actions={
          <Button size="sm" variant="ghost" onClick={() => route.navigate('patients')}>View all</Button>
        } flush>
          {summary.loading ? (
            <TableSkeleton rows={5} cols={2} />
          ) : !data?.recentPatients.length ? (
            <EmptyState icon="patients" title="No patients yet" text="Add your first patient to get started." compact />
          ) : (
            <ul className="list-rows">
              {data.recentPatients.map((patient) => (
                <li key={patient.id}>
                  <button type="button" className="list-row" onClick={() => route.navigate(`patients/${patient.id}`)}>
                    <span className="list-row-main">
                      <span className="truncate">{patient.full_name}</span>
                      <span className="text-xs text-3 mono">{patient.patient_code} · {patient.phone}</span>
                    </span>
                    <span className="text-xs text-3">{date(patient.created_at, prefs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-2 mt-4">
        {app.has('payments.view') && data?.revenue ? (
          <Card title="Collection trend" icon="trending-up" subtitle="Last 14 days with recorded payments">
            {!trend ? (
              <EmptyState icon="activity" title="No payments yet" text="Recorded payments will chart here." compact />
            ) : (
              <div className="bar-chart" role="img" aria-label="Daily collection for the last 14 days">
                {trend.rows.map((row) => {
                  const value = Number(row.collected_poisha);
                  const heightPct = Math.max(2, Math.round((value / trend.max) * 100));
                  return (
                    <div className="bar-col" key={row.day} title={`${date(row.day, prefs)}: ${money(value, prefs)}`}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ height: `${heightPct}%` }}>
                          {value > 0 ? <span className="bar-value">{numerals(money(value, prefs, { decimals: 0, symbol: false }), prefs.bengaliNumerals)}</span> : null}
                        </div>
                      </div>
                      <div className="bar-label">{date(row.day, prefs).slice(0, 6)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        ) : null}

        {app.has('invoices.view') ? (
          <Card title="Top treatments this month" icon="treatments" subtitle="By invoiced value">
            {summary.loading ? (
              <TableSkeleton rows={4} cols={2} />
            ) : !data?.topTreatments.length ? (
              <EmptyState icon="treatments" title="Nothing invoiced yet" text="Treatment revenue appears here once invoices are raised." compact />
            ) : (
              <ul className="rank-list">
                {data.topTreatments.map((row, index) => {
                  const max = Math.max(...data.topTreatments.map((r) => Number(r.total_poisha)), 1);
                  const pct = Math.round((Number(row.total_poisha) / max) * 100);
                  return (
                    <li className="rank-item" key={row.description}>
                      <span className="rank-index">{index + 1}</span>
                      <span className="rank-main">
                        <span className="rank-label truncate">{row.description}</span>
                        <span className="rank-track"><span className="rank-fill" style={{ width: `${pct}%` }} /></span>
                      </span>
                      <span className="rank-value mono">{money(row.total_poisha, prefs, { decimals: 0 })}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {app.has('payments.view') ? (
        <div className="grid grid-2 mt-4">
          <Card title="Upcoming appointments" icon="calendar-check" flush>
            {!data?.upcoming.length ? (
              <EmptyState icon="calendar" title="Nothing scheduled" text="Future appointments appear here." compact />
            ) : (
              <ul className="list-rows">
                {data.upcoming.map((row) => (
                  <li key={row.id}>
                    <button type="button" className="list-row" onClick={() => route.navigate(`appointments?highlight=${row.id}`)}>
                      <span className="list-row-main">
                        <strong className="truncate">{row.patient_name}</strong>
                        <span className="text-xs text-3">
                          <Icon name="clock" size={11} /> {dateAndTime(row.appointment_date, row.start_time, prefs)} · {row.dentist_name ?? 'Unassigned'}
                        </span>
                      </span>
                      <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Latest payments" icon="payments" flush actions={
            <Button size="sm" variant="ghost" onClick={() => route.navigate('billing/payments')}>View all</Button>
          }>
            {!data?.recentPayments.length ? (
              <EmptyState icon="payments" title="No payments recorded" compact />
            ) : (
              <ul className="list-rows">
                {data.recentPayments.map((row) => (
                  <li key={row.id}>
                    <button type="button" className="list-row" onClick={() => route.navigate('billing/payments')}>
                      <span className="list-row-main">
                        <strong className="truncate">{row.patient_name}</strong>
                        <span className="text-xs text-3 mono">{row.payment_no} · {date(row.payment_date, prefs)}</span>
                      </span>
                      <span className="mono text-ok">{money(row.amount_poisha, prefs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      <p className="text-xs text-3 mt-4 row row-1" style={{ gap: 6 }}>
        <Icon name="shield" size={13} /> All figures are read from the local database on this computer.
      </p>
    </>
  );
}

export const DASHBOARD_ICONS: IconName[] = ['dashboard', 'calendar', 'queue', 'payments'];
