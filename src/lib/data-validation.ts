export interface ValidationReport {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a ValidationSession object structure and content.
 */
export function validateSession(data: any): ValidationReport {
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
    if (!validModes.includes(data.settings.validationMode)) {
      errors.push(`Invalid validation mode: ${data.settings.validationMode}`);
    }
  }

  const validStatuses = ['pending', 'in-progress', 'completed', 'paused', 'stopped'];
  if (!validStatuses.includes(data.status)) {
    errors.push(`Invalid session status: ${data.status}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a single ValidationResult object.
 */
export function validateResult(data: any): ValidationReport {
  const errors: string[] = [];

  if (!data.email || typeof data.email !== 'string') {
    errors.push('Invalid or missing email');
  }

  if (!data.result || typeof data.result !== 'string') {
    errors.push('Invalid or missing result');
  } else {
    const validResults = ['Safe', 'Risky', 'Invalid', 'Unknown'];
    if (!validResults.includes(data.result)) {
      errors.push(`Invalid result value: ${data.result}`);
    }
  }

  if (!data.domain || typeof data.domain !== 'string') {
    errors.push('Invalid or missing domain');
  }

  if (typeof data.riskScore !== 'number' || data.riskScore < 0 || data.riskScore > 100) {
    errors.push('Invalid risk score');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a batch of validation results.
 */
export function validateResultsBatch(results: any[]): ValidationReport {
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
    errors
  };
}
