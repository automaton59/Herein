import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterArchiveControls } from './CharacterArchiveControls';

describe('CharacterArchiveControls', () => {
  it('exports profile and full character archives', async () => {
    const onExportArchive = vi.fn().mockResolvedValue('D:/character.zip');

    render(
      <CharacterArchiveControls
        characterId="char-1"
        onExportArchive={onExportArchive}
        onImportArchive={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出角色档案' }));
    expect(onExportArchive).toHaveBeenCalledWith('char-1', 'profile');
    expect(await screen.findByText('已导出：D:/character.zip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导出完整归档' }));
    expect(onExportArchive).toHaveBeenCalledWith('char-1', 'full');
  });

  it('imports a character archive from the typed path', () => {
    const onImportArchive = vi.fn().mockResolvedValue('char-imported');

    render(
      <CharacterArchiveControls
        characterId="char-1"
        onExportArchive={vi.fn()}
        onImportArchive={onImportArchive}
      />,
    );

    fireEvent.change(screen.getByLabelText('角色归档路径'), {
      target: { value: 'D:/character.zip' },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入角色归档' }));

    expect(onImportArchive).toHaveBeenCalledWith('D:/character.zip');
  });
});
