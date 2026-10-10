const saoPauloDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Instante ISO 8601 com fuso explícito. Sem fuso, "2026-03-12T22:02:00" seria lido
// no fuso do servidor e "2026-03-12" como meia-noite UTC, que em São Paulo ainda é
// o dia 11: os dois mudam o dia do prazo sem ninguém perceber.
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export function parseApprovedAt(value: string): Date | null {
  const match = ISO_INSTANT.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // new Date("2026-02-30T…") rola para 2 de março; aqui a data impossível é recusada.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const instant = new Date(value.trim());
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function approvedCivilDay(approvedAt: string): string {
  const parts: Record<string, string> = {};
  for (const { type, value } of saoPauloDay.formatToParts(new Date(approvedAt))) parts[type] = value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isPastDeadline(approvedAt: string, deadlineDate: string): boolean {
  return approvedCivilDay(approvedAt) > deadlineDate;
}
