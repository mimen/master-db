/**
 * Helper functions to generate realistic test data
 */

export function generateRandomId(prefix = 'test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

export function generateRandomContent(type: 'task' | 'note' | 'project' = 'task') {
  const prefixes = {
    task: ['Complete', 'Review', 'Update', 'Create', 'Check'],
    note: ['Note:', 'Remember:', 'Important:', 'TODO:', 'FYI:'],
    project: ['Project', 'Initiative', 'Sprint', 'Feature', 'Module']
  };
  
  const subjects = {
    task: ['report', 'presentation', 'code', 'documentation', 'meeting notes'],
    note: ['deadline tomorrow', 'meeting at 3pm', 'follow up required', 'waiting for approval'],
    project: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
  };
  
  const prefix = prefixes[type][Math.floor(Math.random() * prefixes[type].length)];
  const subject = subjects[type][Math.floor(Math.random() * subjects[type].length)];
  
  return `${prefix} ${subject}`;
}

export function generateRandomLabels(count = 0): string[] {
  const allLabels = ['urgent', 'work', 'personal', 'home', 'shopping', 'health', 'finance', 'travel'];
  const labels: string[] = [];
  
  for (let i = 0; i < count && i < allLabels.length; i++) {
    const randomIndex = Math.floor(Math.random() * allLabels.length);
    if (!labels.includes(allLabels[randomIndex])) {
      labels.push(allLabels[randomIndex]);
    }
  }
  
  return labels;
}

export function generateDueDate(daysFromNow = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return {
    date: date.toISOString().split('T')[0],
    string: daysFromNow === 0 ? 'today' : daysFromNow === 1 ? 'tomorrow' : `in ${daysFromNow} days`,
    datetime: date.toISOString(),
  };
}