import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FileDiff, FolderOpen, GitBranch, GitCommitHorizontal, Minus, Plus, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";
import { t, tn } from "../i18n";
import { confirmAsk } from "../lib/dialogs";
import { relativeTime } from "../lib/format";
import { api } from "../lib/ipc";
import { openExternal, revealInExplorer } from "../lib/links";
import { basename, dirname, relative } from "../lib/paths";
import { useStore } from "../lib/store";
import type { GitBranch as Branch, GitCommit, GitFile, GitFileStatus } from "../lib/types";
import { FileIcon } from "./FileIcon";
import { useMenu, type MenuEntry } from "./Menu";

const MAX_ROWS = 300;

export const GIT_LETTER: Record<GitFileStatus, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };

function statusLabel(status: GitFileStatus): string {
  switch (status) {
    case "modified":
      return t("git.status.modified");
    case "added":
      return t("git.status.added");
    case "deleted":
      return t("git.status.deleted");
    case "renamed":
      return t("git.status.renamed");
    case "untracked":
      return t("git.status.untracked");
    default:
      return t("git.status.conflict");
  }
}

function useGitActions() {
  const { gitRun, toast, openFile, setCompare } = useStore.getState();
  return useMemo(
    () => ({
      stage: (paths: string[], stage: boolean) => void gitRun((root) => api.gitStage(root, paths, stage)),
      discard: async (file: GitFile) => {
        if (!(await confirmAsk(t("git.discardConfirm", { name: basename(file.path) }), t("git.discard").replace("…", "")))) return;
        await gitRun((root) => api.gitDiscard(root, [file.path]));
      },
      show: async (file: GitFile) => {
        if (file.status === "deleted") return;
        await openFile(file.path);
        setCompare(file.status === "untracked" || file.status === "added" ? null : file.path);
      },
      sync: async (op: "fetch" | "pull" | "push") => {
        const done = await gitRun((root) => api.gitSync(root, op));
        if (done !== undefined) toast("success", t(op === "push" ? "git.pushed" : op === "pull" ? "git.pulled" : "git.fetched"));
      },
    }),
    [gitRun, toast, openFile, setCompare],
  );
}

type RowMenu = ReturnType<typeof useMenu>;

function FileRow({ file, staged, root, menu }: { file: GitFile; staged: boolean; root: string; menu: RowMenu }) {
  const actions = useGitActions();
  const compare = useStore((s) => s.compare);
  const active = useStore((s) => s.active);
  const on = !!active && active.toLowerCase() === file.path.toLowerCase();
  const dir = dirname(relative(root, file.path));
  const context = (e: React.MouseEvent) => {
    e.preventDefault();
    const entries: MenuEntry[] = [];
    if (file.status !== "deleted") {
      if (file.status !== "untracked" && file.status !== "added") entries.push({ type: "item", label: t("git.showDiff"), icon: <FileDiff size={14} />, onSelect: () => void actions.show(file) });
      entries.push({ type: "item", label: t("git.openFile"), icon: <FileIcon path={file.path} size={14} />, onSelect: () => void useStore.getState().openFile(file.path).then(() => useStore.getState().setCompare(null)) });
      entries.push({ type: "item", label: t("ctx.showInExplorer"), icon: <FolderOpen size={14} />, onSelect: () => void revealInExplorer(file.path) });
      entries.push({ type: "separator" });
    }
    entries.push({ type: "item", label: staged ? t("git.unstage") : t("git.stage"), icon: staged ? <Minus size={14} /> : <Plus size={14} />, onSelect: () => actions.stage([file.path], !staged) });
    if (!staged) entries.push({ type: "item", label: t("git.discard"), icon: <Undo2 size={14} />, danger: true, onSelect: () => void actions.discard(file) });
    menu.open({ x: e.clientX, y: e.clientY, entries });
  };
  return (
    <div className={`tree-row git-row${on ? " selected" : ""}${on && compare ? " comparing" : ""}`} title={`${relative(root, file.path)} — ${statusLabel(file.status)}`} onClick={() => void actions.show(file)} onContextMenu={context}>
      <FileIcon path={file.path} size={14} />
      <span className={`name${file.status === "deleted" ? " gone" : ""}`}>{basename(file.path)}</span>
      {dir && dir !== "." && <span className="faint ellipsis git-dir">{dir}</span>}
      <span className="git-actions" onClick={(e) => e.stopPropagation()}>
        {!staged && (
          <button className="icon-btn" title={t("git.discard").replace("…", "")} onClick={() => void actions.discard(file)}>
            <Undo2 size={13} />
          </button>
        )}
        <button className="icon-btn" title={staged ? t("git.unstage") : t("git.stage")} onClick={() => actions.stage([file.path], !staged)}>
          {staged ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </span>
      <span className={`git-badge s-${file.status}`}>{GIT_LETTER[file.status]}</span>
    </div>
  );
}

function Group({ title, files, staged, root, menu }: { title: string; files: GitFile[]; staged: boolean; root: string; menu: RowMenu }) {
  const actions = useGitActions();
  if (!files.length) return null;
  return (
    <div className="git-group">
      <div className="git-group-head">
        <span>{title}</span>
        <span className="faint">{files.length}</span>
        <span className="grow" />
        <button className="icon-btn" title={staged ? t("git.unstageAll") : t("git.stageAll")} onClick={() => actions.stage(files.map((f) => f.path), !staged)}>
          {staged ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </div>
      {files.slice(0, MAX_ROWS).map((f) => (
        <FileRow key={`${staged ? "s" : "w"}:${f.path}`} file={f} staged={staged} root={root} menu={menu} />
      ))}
      {files.length > MAX_ROWS && <div className="git-more faint">{tn("git.more", files.length - MAX_ROWS)}</div>}
    </div>
  );
}

function BranchButton() {
  const git = useStore((s) => s.git)!;
  const busy = useStore((s) => s.gitBusy);
  const menu = useMenu();
  const [naming, setNaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { gitRun, toast } = useStore.getState();

  useEffect(() => {
    if (naming) input.current?.focus();
  }, [naming]);

  const switchTo = async (name: string, create: boolean) => {
    const done = await gitRun((root) => api.gitSwitch(root, name, create).then(() => true));
    if (done) toast("success", t("git.switched", { branch: name }));
  };

  const open = async (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const root = useStore.getState().project?.root;
    const list: Branch[] = root ? await api.gitBranches(root).catch(() => []) : [];
    const local = list.filter((b) => !b.remote);
    const remote = list.filter((b) => b.remote && !local.some((l) => b.name.endsWith(`/${l.name}`)));
    const entries: MenuEntry[] = local.map((b) => ({ type: "item", label: b.name, checked: b.current, icon: <GitBranch size={14} />, onSelect: () => !b.current && void switchTo(b.name, false) }));
    if (entries.length) entries.push({ type: "separator" });
    entries.push({ type: "item", label: t("git.newBranch"), icon: <Plus size={14} />, onSelect: () => setNaming(true) });
    if (remote.length) {
      entries.push({ type: "separator" }, { type: "title", label: t("git.remotes") });
      for (const b of remote) entries.push({ type: "item", label: b.name, onSelect: () => void switchTo(b.name.slice(b.name.indexOf("/") + 1), false) });
    }
    menu.open({ x: rect.left, y: rect.bottom + 4, entries, minWidth: Math.max(200, rect.width) });
  };

  if (naming)
    return (
      <div className="field git-branch-field">
        <GitBranch size={13} />
        <input
          ref={input}
          placeholder={t("git.newBranchName")}
          onKeyDown={(e) => {
            const value = e.currentTarget.value.trim();
            if (e.key === "Escape") setNaming(false);
            if (e.key === "Enter" && value) {
              setNaming(false);
              void switchTo(value, true);
            }
          }}
          onBlur={() => setNaming(false)}
        />
      </div>
    );
  return (
    <>
      <button className="git-branch" disabled={busy} onClick={(e) => void open(e)} title={t("git.branch")}>
        <GitBranch size={13} />
        <span className="ellipsis">{git.branch ?? t("git.noBranch")}</span>
        <ChevronDown size={11} className="faint" />
      </button>
      {menu.node}
    </>
  );
}

function History({ root, head }: { root: string; head: string | null }) {
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .gitLog(root, 40)
      .catch(() => [] as GitCommit[])
      .then((list) => {
        if (!cancelled) setCommits(list);
      });
    return () => {
      cancelled = true;
    };
  }, [open, root, head]);
  return (
    <div className="git-group">
      <div className="git-group-head clickable" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`git-twist${open ? " open" : ""}`} />
        <span>{t("git.history")}</span>
      </div>
      {open && commits && !commits.length && <div className="empty-hint">{t("git.noCommits")}</div>}
      {open &&
        commits?.map((c) => (
          <div key={c.hash} className="git-commit" title={`${c.hash}\n${c.subject}`}>
            <GitCommitHorizontal size={13} className="faint" />
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis">{c.subject}</div>
              <div className="faint ellipsis git-meta">
                {c.short} · {c.author} · {relativeTime(new Date(c.time * 1000).toISOString())}
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

export function SourceControl() {
  const project = useStore((s) => s.project)!;
  const git = useStore((s) => s.git);
  const busy = useStore((s) => s.gitBusy);
  const actions = useGitActions();
  const menu = useMenu();
  const [message, setMessage] = useState("");
  const { gitRun, toast, refreshGit, ensureTrusted } = useStore.getState();

  useEffect(() => {
    void refreshGit();
  }, [refreshGit, project.root]);

  if (!git) return <div className="empty-hint">{t("search.searching")}</div>;
  if (!git.available)
    return (
      <div className="empty-hint">
        <strong>{t("git.missing")}</strong>
        <br />
        {t("git.missingHint")}
        <div className="git-cta">
          <button className="btn small" onClick={() => void openExternal("https://git-scm.com/downloads/win")}>
            {t("git.install")}
          </button>
        </div>
      </div>
    );
  if (git.locked)
    return (
      <div className="empty-hint">
        {t("git.locked")}
        <div className="git-cta">
          <button className="btn small" onClick={() => void ensureTrusted()}>
            <ShieldCheck size={13} />
            {t("git.trust")}
          </button>
        </div>
      </div>
    );
  if (!git.repo)
    return (
      <div className="empty-hint">
        {t("git.noRepo")}
        <div className="git-cta">
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              void gitRun((root) => api.gitInit(root).then(() => true)).then((done) => {
                if (done) toast("success", t("git.initDone"));
              })
            }
          >
            <GitBranch size={13} />
            {t("git.init")}
          </button>
        </div>
      </div>
    );

  const staged = git.files.filter((f) => f.staged);
  const changed = git.files.filter((f) => f.unstaged);
  const everything = staged.length === 0;
  const canCommit = !busy && git.files.length > 0 && message.trim().length > 0;
  const commit = async () => {
    if (!canCommit) return;
    const hash = await gitRun((root) => api.gitCommit(root, message, everything));
    if (hash === undefined) return;
    setMessage("");
    toast("success", t("git.committed", { hash }));
  };

  return (
    <div className="git-panel">
      <div className="git-bar">
        <BranchButton />
        <span className="grow" />
        <button className="icon-btn" disabled={busy} title={t("git.fetch")} onClick={() => void actions.sync("fetch")}>
          <RefreshCw size={13} className={busy ? "spin" : undefined} />
        </button>
        <button className="icon-btn git-sync" disabled={busy} title={t("git.pull")} onClick={() => void actions.sync("pull")}>
          <ArrowDown size={13} />
          {git.behind > 0 && <span>{git.behind}</span>}
        </button>
        <button className="icon-btn git-sync" disabled={busy} title={t("git.push")} onClick={() => void actions.sync("push")}>
          <ArrowUp size={13} />
          {git.ahead > 0 && <span>{git.ahead}</span>}
        </button>
      </div>
      <div className="git-commit-box">
        <textarea
          rows={2}
          placeholder={t("git.message")}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <button className="btn small primary" disabled={!canCommit} onClick={() => void commit()}>
          <Check size={13} />
          {everything ? t("git.commitAll") : t("git.commit")}
        </button>
      </div>
      {!git.files.length && <div className="empty-hint">{t("git.clean")}</div>}
      <Group title={t("git.staged")} files={staged} staged root={project.root} menu={menu} />
      <Group title={t("git.changes")} files={changed} staged={false} root={project.root} menu={menu} />
      <History root={project.root} head={git.head} />
      {menu.node}
    </div>
  );
}
