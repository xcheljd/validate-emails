import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { CorruptSettingsBanner, type CorruptSettingsInfo } from './corrupt-settings-banner';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const info: CorruptSettingsInfo = {
  originalPath: '/home/u/.local/share/app/settings.json',
  backupPath: '/home/u/.local/share/app/settings.json.corrupt-20261003-120000',
  reason: 'could not be parsed: EOF while parsing',
  preserved: true,
  message: 'Your settings file was corrupt. It was moved aside and default settings are being used.',
};

describe('CorruptSettingsBanner', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('shows the warning and backup path when the backend reports corruption', async () => {
    mockInvoke.mockResolvedValue(info);
    render(<CorruptSettingsBanner />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith('get_corrupt_settings_warning');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText(info.message)).toBeInTheDocument();
    expect(screen.getByText(info.backupPath)).toBeInTheDocument();
  });

  it('hides on dismiss', async () => {
    mockInvoke.mockResolvedValue(info);
    render(<CorruptSettingsBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing when settings loaded cleanly', async () => {
    mockInvoke.mockResolvedValue(null);
    render(<CorruptSettingsBanner />);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders nothing if the check fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error('ipc down'));
    render(<CorruptSettingsBanner />);

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});
