export interface ValidationReport {
  valid: boolean;
  errors: string[];
}

/** Minimal shape required by validateSession — avoids circular import with session-manager */
interface SessionData {
  id?: string;
  name?: string;
  emails?: unknown[];
  results?: unknown[];
  settings?: { validationMode?: string };
  status?: string;
}

/**
 * Validates a ValidationSession object structure and content.
 */
export function validateSession(data: SessionData): ValidationReport {
  const errors: string[] = [];

  if (!data.id || typeof data.id !== 'string') {
    errors.push('Invalid or missing session ID');
  }

  if (!data.name || typeof data.name !== 'string') {
    errors.push('Invalid or missing session name');
  }

  if (!data.emails || !Array.isArray(data.emails)) {
    errors.push('Invalid or missing emails array');
  }

  if (!data.results || !Array.isArray(data.results)) {
    errors.push('Invalid or missing results array');
  }

  if (!data.settings || typeof data.settings !== 'object') {
    errors.push('Invalid or missing settings object');
  } else {
    const validModes = ['quick', 'standard', 'thorough'];
    const mode = data.settings.validationMode;
    if (!mode || !validModes.includes(mode)) {
      errors.push(`Invalid validation mode: ${data.settings.validationMode}`);
    }
  }

  const validStatuses = [
    'pending',
    'in-progress',
    'completed',
    'paused',
    'stopped',
  ];
  const status = data.status;
  if (!status || !validStatuses.includes(status)) {
    errors.push(`Invalid session status: ${data.status}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a single ValidationResult object.
 */
export function validateResult(data: unknown): ValidationReport {
  const errors: string[] = [];
  const record = data as Record<string, unknown>;

  if (!record.email || typeof record.email !== 'string') {
    errors.push('Invalid or missing email');
  }

  if (!record.result || typeof record.result !== 'string') {
    errors.push('Invalid or missing result');
  } else {
    const validResults = ['Safe', 'Risky', 'Invalid', 'Unknown'];
    if (!validResults.includes(record.result)) {
      errors.push(`Invalid result value: ${record.result}`);
    }
  }

  // Domain may legitimately be an empty string for invalid-syntax emails
  // (check_syntax returns no domain when there is no "@"). Only the type matters.
  if (typeof record.domain !== 'string') {
    errors.push('Invalid or missing domain');
  }

  if (
    typeof record.riskScore !== 'number' ||
    record.riskScore < 0 ||
    record.riskScore > 100
  ) {
    errors.push('Invalid risk score');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a batch of validation results.
 */
export function validateResultsBatch(results: unknown[]): ValidationReport {
  const errors: string[] = [];

  if (!Array.isArray(results)) {
    return { valid: false, errors: ['Results must be an array'] };
  }

  results.forEach((result, index) => {
    const report = validateResult(result);
    if (!report.valid) {
      errors.push(`Result at index ${index}: ${report.errors.join(', ')}`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
