type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function parseTime(value: string): { hour: string; minute: string } {
  const [h, m] = value.split(":");
  return {
    hour: (h ?? "09").padStart(2, "0"),
    minute: (m ?? "00").padStart(2, "0"),
  };
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

export function TimePicker({ value, onChange, disabled }: TimePickerProps) {
  const { hour, minute } = parseTime(value);
  const resolvedMinute = MINUTES.includes(minute) ? minute : (MINUTES[0] ?? "00");

  return (
    <div className="time-picker">
      <select
        className="time-picker-select"
        value={hour}
        onChange={(e) => onChange(`${e.target.value}:${resolvedMinute}`)}
        disabled={disabled}
        aria-label="Hour"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="time-picker-sep" aria-hidden="true">:</span>
      <select
        className="time-picker-select"
        value={resolvedMinute}
        onChange={(e) => onChange(`${hour}:${e.target.value}`)}
        disabled={disabled}
        aria-label="Minute"
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}
