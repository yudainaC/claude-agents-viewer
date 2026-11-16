import { useEffect, useState } from "react";
import type { DirListing } from "../server/types.ts";

/** Fenêtre pour choisir le dossier d'un projet sur ta machine. */
export function FolderPicker({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (p?: string) => {
    fetch(`/api/fs${p ? `?path=${encodeURIComponent(p)}` : ""}`)
      .then((r) => r.json())
      .then((d: DirListing) => {
        setListing(d);
        setTyped(d.path);
      })
      .catch(() => setError("Impossible de lire ce dossier."));
  };

  useEffect(() => open(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const crumbs = listing ? listing.path.split(/[\\/]/).filter(Boolean) : [];
  const sep = listing?.path.includes("\\") ? "\\" : "/";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Choisir un dossier" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Ouvrir un projet</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <form
          className="path-form"
          onSubmit={(e) => {
            e.preventDefault();
            open(typed);
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} aria-label="Chemin du dossier" />
          <button className="btn" type="submit">
            Aller
          </button>
        </form>
        {listing && (
          <>
            <nav className="crumbs">
              <button onClick={() => open(listing.home)}>🏠</button>
              {crumbs.map((c, i) => {
                const p = (listing.path.startsWith(sep) ? sep : "") + crumbs.slice(0, i + 1).join(sep) + (i === 0 && !listing.path.startsWith(sep) ? sep : "");
                return (
                  <span key={i}>
                    <span className="muted">/</span>
                    <button onClick={() => open(p)}>{c}</button>
                  </span>
                );
              })}
            </nav>
            <ul className="dir-list">
              {listing.parent && (
                <li>
                  <button onClick={() => open(listing.parent)}>
                    <span className="dir-icon">↩</span> Dossier parent
                  </button>
                </li>
              )}
              {listing.dirs.map((d) => (
                <li key={d.path}>
                  <button onDoubleClick={() => onPick(d.path)} onClick={() => open(d.path)}>
                    <span className="dir-icon">📁</span> {d.name}
                    {d.isRepo && <span className="repo-tag">git</span>}
                  </button>
                </li>
              ))}
              {listing.dirs.length === 0 && <li className="muted empty">Aucun sous-dossier.</li>}
            </ul>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-foot">
          <span className="muted small">{listing?.isRepo ? "Dépôt git détecté ✓" : "Navigue jusqu'au dossier de ton projet."}</span>
          <button className="btn primary" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
            Travailler dans ce dossier
          </button>
        </footer>
      </div>
    </div>
  );
}
