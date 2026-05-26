// A simple multi-select rendered as toggleable pills. No external dependency —
// just buttons with aria-pressed, so it stays accessible and mobile-friendly.

interface MultiSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  error?: string | null;
  hint?: string;
}

export function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
}: MultiSelectProps<T>) {
  function toggle(option: T) {
    onChange(
      value.includes(option)
        ? value.filter((v) => v !== option)
        : [...value, option],
    );
  }

  return (
    <fieldset className="w-full">
      <legend className="text-sm font-medium text-primary-800">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(option)}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm transition-colors ${
                selected
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-cream-300 bg-white text-primary-700 hover:border-primary-300'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-sm text-primary-400">{hint}</p>
      ) : null}
    </fieldset>
  );
}
