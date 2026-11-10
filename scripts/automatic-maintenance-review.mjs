export function automaticMaintenanceReviewCandidates(report, now = new Date()) {
  const age = +now - Date.parse(report?.checkedAt);
  if (!(age >= 0 && age < 48 * 3600000) || report.mode !== 'owner-authorized-source-backed') return [];
  const reasons = {
    'copy-needs-grounded-review': 'Titel oder vollständige Bedingungen brauchen einen eindeutigen Quellenbeleg',
    'source-year-or-end-not-confirmed': 'Aktionsende oder Jahr nicht eindeutig belegt; bleibt sichtbar',
    'original-post-date-needs-manual-review': 'Originalpost oder Aktionsdatum nicht eindeutig; bleibt sichtbar',
    'ongoing-extended-or-uncertain': 'Dauerangebot oder mögliche Verlängerung; bleibt sichtbar',
    'newer-manual-period-correction': 'Neuere manuelle Datumsänderung bleibt maßgeblich',
  };
  return (report.review || []).filter(row => row.id).map(row => ({ id: row.id,
    reason: `Automatische Pflege: ${reasons[row.reason] || 'Gültigkeit anhand der Originalquelle prüfen; keine automatische Entfernung'}`,
    details: { sourceSystem: 'automatic-maintenance-review', automaticRemovalEligible: false } }));
}
