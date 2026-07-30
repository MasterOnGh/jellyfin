import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    DownloadCoreError,
    pause,
    resume,
    start,
    type DownloadRecord
} from '../../downloads';
import { usePlaybackClient } from '../../app/runtime';
import { useOnlineStatus } from '../../app/useOnlineStatus';
import type { MediaItem } from '../catalog/catalog';
import { useProfile } from '../profiles';
import { useCatalog } from '../catalog/catalog';
import { useI18n } from '../../i18n';
import {
    OfflineMediaUnsupportedError,
    prepareDownload
} from './prepareDownload';
import styles from './DownloadButton.module.css';

export function DownloadButton({
    compact = false,
    item,
    loading = false,
    record
}: {
    compact?: boolean;
    item: MediaItem;
    loading?: boolean;
    record: DownloadRecord | null;
}) {
    const navigate = useNavigate();
    const online = useOnlineStatus();
    const playbackClient = usePlaybackClient();
    const { activeProfile } = useProfile();
    const { locale, profileId, userId } = useCatalog();
    const { t } = useI18n();
    const itemId = item.Id ?? '';
    const [ pending, setPending ] = useState(false);
    const [ error, setError ] = useState('');

    if (!itemId || !activeProfile || ![ 'Episode', 'Movie' ].includes(item.Type ?? '')) {
        return null;
    }

    const percent = record?.totalBytes
        ? Math.min(100, Math.round(record.bytesDownloaded / record.totalBytes * 100))
        : null;
    const label = record?.status === 'completed'
        ? locale === 'fr' ? 'Lire hors ligne' : 'Play offline'
        : record?.status === 'downloading'
            ? percent === null
                ? locale === 'fr' ? 'Mettre en pause' : 'Pause'
                : `${locale === 'fr' ? 'Pause' : 'Pause'} · ${percent}%`
            : record
                ? locale === 'fr' ? 'Reprendre le téléchargement' : 'Resume download'
                : t('download');

    const act = async () => {
        setPending(true);
        setError('');
        try {
            if (record?.status === 'completed') {
                navigate(`/offline-watch/${record.id}`);
                return;
            }
            if (record?.status === 'downloading') {
                await pause(record.id);
                return;
            }
            if (record) {
                await resume(record.id, { authHeaders: playbackClient.authHeaders() });
                return;
            }

            const prepared = await prepareDownload(
                playbackClient,
                {
                    Id: itemId,
                    ...(item.Name === undefined ? {} : { Name: item.Name }),
                    ...(item.RunTimeTicks === undefined ? {} : { RunTimeTicks: item.RunTimeTicks }),
                    ...(item.Type === undefined ? {} : { Type: item.Type })
                },
                userId,
                activeProfile.PlaybackPreferences
            );
            await start({
                authHeaders: prepared.headers,
                indexNumber: item.IndexNumber ?? null,
                itemId,
                itemType: item.Type ?? null,
                mimeType: prepared.mimeType,
                name: item.Name?.trim() || (locale === 'fr' ? 'Sans titre' : 'Untitled'),
                parentIndexNumber: item.ParentIndexNumber ?? null,
                productionYear: item.ProductionYear ?? null,
                profileId,
                runtimeTicks: item.RunTimeTicks ?? null,
                seriesName: item.SeriesName ?? null,
                sourceUrl: prepared.url,
                userId
            });
        } catch (cause) {
            setError(cause instanceof OfflineMediaUnsupportedError
                ? locale === 'fr'
                    ? 'Ce fichier ne peut pas être conservé dans un format lisible hors ligne.'
                    : 'This file cannot be stored in an offline-playable format.'
                : cause instanceof DownloadCoreError && cause.code === 'quota'
                    ? locale === 'fr'
                        ? 'Espace de stockage insuffisant.'
                        : 'Not enough storage space.'
                    : locale === 'fr'
                        ? 'Le téléchargement n’a pas pu démarrer.'
                        : 'The download could not start.');
        } finally {
            setPending(false);
        }
    };

    return (
        <span className={`${styles.wrapper} ${compact ? styles.compact : ''}`}>
            <button
                className={styles.button}
                disabled={loading || pending || (!online && record?.status !== 'completed' && record?.status !== 'downloading')}
                onClick={() => void act()}
                type='button'
            >
                {label}
            </button>
            {error && <small className={styles.error} role='alert'>{error}</small>}
        </span>
    );
}
