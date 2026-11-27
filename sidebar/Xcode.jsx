// The Xcode part of the sidebar (was Stellar's own Xcode tab): pick project, scheme, configuration, team and
// destination, then Run, Build, Test, Clean or Archive in a terminal tab; and the archives of the scheme, each with its
// details and an upload to App Store Connect. The main code (main.mjs, lib/xcode.mjs) does the work.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog, useExtension, useStellar, useT } from 'stellar';
import { Button, Icon, IconButton, Select } from 'stellar/ui';

const TASKS = [
  { action: 'build', label: 'Build', icon: 'Hammer' },
  { action: 'test', label: 'Test', icon: 'Flask' },
  { action: 'clean', label: 'Clean', icon: 'Broom' },
  { action: 'archive', label: 'Archive', icon: 'Archive', titleKey: 'archiveTitle' },
];
const destKey = (d) => d.id || `generic:${d.platform}`;
const pick = (list, chosen, preferred) => (list?.includes(chosen) ? chosen : list?.includes(preferred) ? preferred : list?.[0] || null);

/** An iPhone simulator by default: the usual first choice in Xcode too. */
function defaultDestination(list) {
  const concrete = list.filter((d) => !d.generic);
  return concrete.find((d) => d.platform === 'iOS Simulator' && /^iPhone/.test(d.name)) || concrete[0] || list[0] || null;
}

const GROUPS = [
  ['devices', (d) => !d.generic && !/Simulator$/.test(d.platform)],
  ['simulators', (d) => !d.generic && /Simulator$/.test(d.platform)],
  ['generic', (d) => d.generic],
];

/** One of the main code's answers as `{ data, error, loading, reload }`; `args` null: not asked (yet). */
function useCall(extension, method, args) {
  const key = args === null ? null : JSON.stringify(args);
  const [state, setState] = useState({ data: null, error: '', loading: key !== null });
  const reload = useCallback(() => {
    if (key === null) { setState({ data: null, error: '', loading: false }); return Promise.resolve(); }
    setState((s) => ({ ...s, loading: true }));
    return extension.call(method, JSON.parse(key)).then((data) => setState({ data, error: '', loading: false }), (e) => setState({ data: null, error: e.message, loading: false }));
  }, [extension, method, key]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

// A div, not a label: the control is a button, which a label would toggle a second time.
const Field = ({ label, children }) => <div className="flex flex-col gap-[3px] text-[11px] text-muted-foreground [&>span]:flex [&>span]:items-center [&>span]:justify-between"><span>{label}</span>{children}</div>;

const archiveDate = (archive, t, locale) => (archive.created
  ? new Date(archive.created).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : t('dateUnknown'));

/** An archive's details, in a dialog (opened with openDialog from the Archives section). */
export function ArchiveDetails({ archive, locale }) {
  const t = useT();
  const extension = useExtension();
  const dialog = useDialog();
  const upload = () => extension.call('run', { task: { action: 'upload', scheme: archive.scheme, archivePath: archive.path } }).then(() => dialog.close(true));
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-4 [&>div]:flex [&>div]:flex-col [&>div]:gap-[5px] [&_strong]:text-[18px] [&_span]:text-muted-foreground">
        <Icon name="Archive" size={28} />
        <div><strong>{archive.name}</strong><span>{archive.version}{archive.build ? ` (${archive.build})` : ''}</span></div>
      </div>
      <dl className="mb-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:wrap-anywhere">
        <dt>Scheme</dt><dd>{archive.scheme}</dd>
        <dt>{t('created')}</dt><dd>{archiveDate(archive, t, locale)}</dd>
        <dt>Bundle ID</dt><dd>{archive.bundleId || t('noApp')}</dd>
        <dt>{t('location')}</dt><dd>{archive.path}</dd>
      </dl>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        <Button variant="outline" icon="ExternalLink" autoFocus onClick={() => extension.call('open', { path: archive.path })}>{t('openXcode')}</Button>
        <Button variant="default" icon="Upload" disabled={!archive.uploadable} title={t('uploadTitle')} onClick={upload}>{t('upload')}</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('uploadNote')}</p>
    </div>
  );
}

/** The Bouwen and Archives sections, as props for <Section>. Null while the project has no Xcode project. */
export function useXcodeSections() {
  const t = useT();
  const extension = useExtension();
  const stellar = useStellar();
  // Dates as the computer shows them.
  const locale = undefined;
  const info = useCall(extension, 'info', {});
  const formatter = useCall(extension, 'formatter', {});
  const teams = useCall(extension, 'teams', {});
  const [choices, setChoices] = useState({});
  useEffect(() => { extension.call('choices').then(setChoices, () => {}); }, [extension]);
  const choose = (patch) => { setChoices((c) => ({ ...c, ...patch })); extension.call('choose', patch).catch(() => {}); };
  const failed = (title) => (e) => extension.call('failed', { title, message: e.message }).catch(() => {});

  const projects = info.data?.projects || [];
  const project = pick(projects.map((p) => p.path), choices.project);
  const schemes = useCall(extension, 'schemes', project ? { project } : null);
  const scheme = pick(schemes.data?.schemes, choices.scheme);
  const configuration = pick(schemes.data?.configurations, choices.configuration, 'Debug');
  const destinations = useCall(extension, 'destinations', scheme ? { project, scheme } : null);
  const list = destinations.data || [];
  const destination = list.find((d) => destKey(d) === choices.destination) || defaultDestination(list);
  const team = teams.data?.some((x) => x.id === choices.team) ? choices.team : '';
  const archives = useCall(extension, 'archives', scheme ? { scheme } : null);
  // New archives show up by themselves (Xcode's Organizer, or an archive that just finished).
  useEffect(() => {
    if (!scheme) return undefined;
    const timer = setInterval(archives.reload, 10000);
    return () => clearInterval(timer);
  }, [scheme, archives.reload]);
  useEffect(() => { if (schemes.error) failed(t('schemesFailed'))({ message: schemes.error }); }, [schemes.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (destinations.error) failed(t('destinationsFailed'))({ message: destinations.error }); }, [destinations.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => GROUPS.map(([heading, test]) => ({
    heading: t(heading), options: list.filter(test).map((d) => ({ value: destKey(d), label: `${d.name}${d.os ? ` (${d.os})` : ''}` })),
  })), [list, t]);

  if (!info.data || !projects.length) return null;
  const ready = Boolean(scheme && configuration && destination);
  const start = (action) => extension.call('run', { task: { action, project, scheme, configuration, destination, team: team || null } }).catch(failed(action));
  const current = projects.find((p) => p.path === project);

  const build = {
    id: 'build',
    title: t('build'),
    weight: 2,
    actions: <IconButton size="sm" icon="ExternalLink" iconSize={12} title={t('openXcode')} tooltip={false} onClick={() => extension.call('open', { project })} />,
    children: (
      <div className="pt-1">
        <div className="flex items-center gap-2.5 [&>div]:min-w-0 [&>div]:flex-1 shrink-0 pt-1.5 pb-2.5">
          <Icon name="Xcode" size={18} />
          <div><div className="font-semibold">{current.name}</div><div className="truncate text-xs text-muted-foreground">{project}</div></div>
        </div>
        <div className="flex flex-col gap-2 pb-3">
          {projects.length > 1 && (
            <Field label="Project">
              <Select label="Project" block className="w-full text-left" value={project} onChange={(value) => choose({ project: value })}
                options={projects.map((p) => ({ value: p.path, label: p.path }))} />
            </Field>
          )}
          <Field label={<>Scheme <IconButton size="sm" icon="RotateCw" iconSize={11} title={t('refreshSchemes')} tooltip={false} disabled={schemes.loading} onClick={schemes.reload} /></>}>
            {schemes.error ? <div className="text-[12px] whitespace-pre-wrap text-destructive">{t('schemesError')}</div> : (
              <Select label="Scheme" block className="w-full text-left" value={scheme || ''} disabled={!schemes.data}
                options={(schemes.data?.schemes || []).map((s) => ({ value: s, label: s }))} onChange={(value) => choose({ scheme: value })} />
            )}
          </Field>
          <Field label={t('configuration')}>
            <Select label={t('configuration')} block className="w-full text-left" value={configuration || ''} disabled={!schemes.data}
              options={(schemes.data?.configurations || []).map((c) => ({ value: c, label: c }))} onChange={(value) => choose({ configuration: value })} />
          </Field>
          {teams.data?.length > 0 && (
            <Field label={<>Team <IconButton size="sm" icon="RotateCw" iconSize={11} title={t('refreshTeams')} tooltip={false} disabled={teams.loading} onClick={teams.reload} /></>}>
              <Select label="Team" block className="w-full text-left" value={team} onChange={(value) => choose({ team: value })}
                options={[{ value: '', label: t('projectTeam') }, ...teams.data.map((x) => ({ value: x.id, label: `${x.name} (${x.id})` }))]} />
            </Field>
          )}
          <Field label={<>{t('destination')} <IconButton size="sm" icon="RotateCw" iconSize={11} title={t('refreshDevices')} tooltip={false} disabled={!scheme || destinations.loading} onClick={destinations.reload} /></>}>
            {destinations.error ? <div className="text-[12px] whitespace-pre-wrap text-destructive">{t('destinationsError')}{'\n'}{destinations.error}</div>
              : scheme && !destinations.loading && !list.length ? <div className="text-[12px] whitespace-pre-wrap text-destructive">{t('noDestinations', { scheme })}</div>
                : <Select label={t('destination')} block className="w-full text-left" disabled={!list.length} value={destination ? destKey(destination) : ''} options={groups}
                  onChange={(key) => choose({ destination: key })} />}
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:px-2.5 [&_[data-slot=button]]:text-[12.5px]">
          <Button variant="default" icon="Play" disabled={!ready || destination.generic} title={destination?.generic ? t('pickDevice') : undefined} onClick={() => start('run')}>Run</Button>
          {TASKS.map((task) => (
            <Button variant="outline" key={task.action} icon={task.icon} disabled={!ready} title={task.titleKey ? t(task.titleKey) : undefined} onClick={() => start(task.action)}>{task.label}</Button>
          ))}
        </div>
        {formatter.data === false && (
          <div className="mt-3 flex gap-[9px] rounded-lg bg-muted px-[11px] py-2.5 text-[12px]">
            <Icon name="Sparkles" size={14} className="mt-px shrink-0 text-foreground" />
            <div className="flex min-w-0 flex-col items-start gap-1 [&_p]:mb-1.5 [&_p]:text-muted-foreground [&_p]:leading-[1.45]">
              <strong>{t('formatterTitle')}</strong>
              <p>{t('formatterText')}</p>
              <Button variant="default" icon="Download" onClick={() => extension.call('installFormatter').then(() => setTimeout(formatter.reload, 15000))}>{t('formatterInstall')}</Button>
            </div>
          </div>
        )}
      </div>
    ),
  };

  const archivesSection = {
    id: 'archives',
    flush: true,
    title: 'Archives',
    count: archives.data?.length,
    weight: 1,
    actions: scheme && <IconButton size="sm" icon="RotateCw" iconSize={12} title={t('refreshArchives')} tooltip={false} disabled={archives.loading} onClick={archives.reload} />,
    children: !scheme ? <div className="p-4 text-center text-muted-foreground">{t('pickScheme')}</div> : (
      <>
        {archives.error && <div className="p-4 text-center text-muted-foreground">{t('archivesError')}</div>}
        {archives.data?.length === 0 && <div className="p-4 text-center text-muted-foreground">{t('noArchives', { scheme })}</div>}
        <div className="flex flex-col gap-1" role="group" aria-label="Archives">
          {archives.data?.map((archive) => (
            <button type="button" key={archive.path} className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-transparent bg-transparent px-[7px] py-2 text-left hover:bg-accent" aria-haspopup="dialog"
              onClick={() => stellar.openDialog(ArchiveDetails, { title: archive.name, subtitle: t('archive'), icon: 'Xcode', props: { archive, locale } }).then(archives.reload)}>
              <Icon name="Archive" size={15} />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="truncate">{archive.name} {archive.version}{archive.build ? ` (${archive.build})` : ''}</span>
                <span className="text-xs text-muted-foreground">{archiveDate(archive, t, locale)}</span>
              </span>
            </button>
          ))}
        </div>
      </>
    ),
  };
  return [build, archivesSection];
}
