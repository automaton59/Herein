import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSettings } from './DataSettings';

describe('DataSettings', () => {
  it('exports a full backup without API key ciphertext by default', async () => {
    const onExportBackup = vi.fn().mockResolvedValue('D:/backup.zip');

    render(<DataSettings onExportBackup={onExportBackup} onRestoreBackup={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '导出完整备份' }));

    expect(onExportBackup).toHaveBeenCalledWith(false);
    expect(await screen.findByText('已导出：D:/backup.zip')).toBeInTheDocument();
  });

  it('restores from the typed backup path', () => {
    const onRestoreBackup = vi.fn().mockResolvedValue(true);

    render(<DataSettings onExportBackup={vi.fn()} onRestoreBackup={onRestoreBackup} />);

    fireEvent.change(screen.getByLabelText('备份文件路径'), {
      target: { value: 'D:/backup.zip' },
    });
    fireEvent.click(screen.getByRole('button', { name: '恢复备份' }));

    expect(onRestoreBackup).toHaveBeenCalledWith('D:/backup.zip');
  });
});
