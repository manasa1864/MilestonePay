import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { canonicalSkill, hasSkill, MAX_SKILLS, SKILLS, suggestSkills } from "../lib/skills";
import { Icon } from "../ui";

type Option = { label: string; custom: boolean };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Skills field: type to see matching skills underneath, pick one and it appears as a chip below
 * the search box. Keep picking more. Anything you type that isn't in the list can still be added:
 * it shows up as an "Add “…”" option, and Enter picks it when nothing in the list matches.
 */
export function SkillPicker({ value, onChange, placeholder = `Search ${SKILLS.length}+ skills, e.g. React`, id, pool, allowCustom = true, caption }: {
  value: string[]; onChange: (skills: string[]) => void; placeholder?: string; id?: string;
  /** Suggest from this list instead of the built-in catalog (e.g. skills that exist on profiles). */
  pool?: string[];
  /** Whether skills missing from the list can be added as typed. */
  allowCustom?: boolean;
  /** Small text under the chips; null hides it. */
  caption?: string | null;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // null = automatic highlight; a number means the user moved it with the arrows or the mouse.
  const [manual, setManual] = useState<number | null>(null);
  const full = value.length >= MAX_SKILLS;
  // Suggestions appear while typing, or on first focus when nothing is picked yet. They never cover picked chips.
  const showList = open && !full && (query.trim() !== "" || value.length === 0);

  const options: Option[] = useMemo(() => {
    const found: Option[] = suggestSkills(query, value, 12, pool).map((label) => ({ label, custom: false }));
    const typed = canonicalSkill(query);
    const exact = found.some((o) => norm(o.label) === norm(typed));
    if (allowCustom && typed.length >= 1 && !hasSkill(value, typed) && !exact) found.push({ label: typed, custom: true });
    return found;
  }, [query, value, pool, allowCustom]);

  // Highlight the best match when it starts with what was typed; otherwise the "Add" option, so
  // typing a skill that isn't listed and pressing Enter adds exactly what was typed.
  const auto = useMemo(() => {
    if (!query.trim()) return 0;
    const q = norm(query);
    const startsWith = options.findIndex((o) => !o.custom && norm(o.label).startsWith(q));
    if (startsWith >= 0) return startsWith;
    const custom = options.findIndex((o) => o.custom);
    return custom >= 0 ? custom : 0;
  }, [options, query]);
  const active = Math.min(manual ?? auto, Math.max(options.length - 1, 0));

  function add(skill: string) {
    if (full || !skill.trim() || hasSkill(value, skill)) return;
    onChange([...value, canonicalSkill(skill)]);
    setQuery("");
    setManual(null);
    setOpen(false);
    inputRef.current?.focus();
  }
  function remove(skill: string) {
    onChange(value.filter((s) => s !== skill));
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setManual(Math.min(active + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setManual(Math.max(active - 1, 0)); }
    else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (showList && options[active]) add(options[active].label);
    }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1));
  }

  return <div className="skill-picker">
    <div className="skill-search">
      <Icon name="search" size={15}/>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={showList && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        value={query}
        disabled={full}
        placeholder={full ? `You've added the maximum of ${MAX_SKILLS} skills` : value.length ? "Add another skill" : placeholder}
        onChange={(e) => { setQuery(e.target.value); setManual(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
    </div>
    {showList && options.length > 0 && (
      <ul className="skill-options" id={listId} role="listbox">
        {options.map((o, i) => (
          <li
            key={`${o.custom ? "custom:" : ""}${o.label}`}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={`${i === active ? "active" : ""} ${o.custom ? "custom" : ""}`}
            onMouseDown={(e) => { e.preventDefault(); add(o.label); }}
            onMouseEnter={() => setManual(i)}
          >
            {o.custom ? <><Icon name="plus" size={13}/><span>Add “{o.label}”<em>not in the list, add it anyway</em></span></> : <span><Highlight text={o.label} query={query}/></span>}
          </li>
        ))}
      </ul>
    )}
    {value.length > 0 && (
      <div className="skill-chips" aria-label="Selected skills">
        {value.map((s) => (
          <span className="skill-chip" key={s}>{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => remove(s)}><Icon name="close" size={11}/></button></span>
        ))}
      </div>
    )}
    {caption !== null && <small className="skill-count">{caption ?? `${value.length} selected (up to ${MAX_SKILLS}) · pick from ${SKILLS.length} suggested skills or type your own · clients can search by these`}</small>}
  </div>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<b>{text.slice(at, at + q.length)}</b>{text.slice(at + q.length)}</>;
}
