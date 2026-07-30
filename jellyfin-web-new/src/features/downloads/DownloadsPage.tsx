import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
    clear as clearDownloads,
    deleteDownload,
    getDownloadStorageStatus,
    pause,
    requestPersistentDownloadStorage,
    resume,
    type DownloadRecord,
    type DownloadStorageStatus
} from '../../downloads';
import { usePlaybackClient } from '../../app/runtime';
import { useOnlineStatus } from '../../app/useOnlineStatus';
import { useCatalog } from '../catalog/catalog';
import { useI18n } from '../../i18n';
import { useDownloadRecords } from './useDownloads';
import styles from './DownloadsPage.module.css';

const formatBytes = (value: number | null) => {
    if (value === null) return '—';
    if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`;
    if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
    return `${(value / 1_000_000_000).toFixed(1)} GB`;
};

const episodeLabel = (record: DownloadRecord) => {
    if (!record.seriesName) return '';
    const number = record.parentIndexNumber == null
        ? ''
        : `S${record.parentIndexNumber}:E${record.indexNumber ?? 0}`;
    return [ record.seriesName, number ].filter(Boolean).join(' · ');
};

export function DownloadsPage() {
    const { locale } = useI18n();
    const { profileId, userId } = useCatalog();
    const client = usePlaybackClient();
    const online = useOnlineStatus();
    const { error, loading, records } = useDownloadRecords(userId, profileId);
    const [ pendingId, setPendingId ] = useState('');
    const [ storage, setStorage ] = useState<DownloadStorageStatus>();
    const [ actionError, setActionError ] = useState('');
    const completedBytes = useMemo(
        () => records.reduce((sum, record) => sum + record.bytesDownloaded, 0),
        [ records ]
    );

    useEffect(() => {
        void getDownloadStorageStatus().then(setStorage, () => setStorage(undefined));
    }, [ records ]);

    const perform = async (id: string, action: () => Promise<unknown>) => {
        setPendingId(id);
        setActionError('');
        try {
            await action();
        } catch {
            setActionError(locale === 'fr'
                ? 'Cette action n’a pas pu être effectuée.'
                : 'This action could not be completed.');
        } finally {
            setPendingId('');
        }
    };

    const remove = (record: DownloadRecord) => {
        const confirmed = window.confirm(locale === 'fr'
            ? `Supprimer « ${record.name} » de cet appareil ?`
            : `Remove “${record.name}” from this device?`);
        if (confirmed) {
            void perform(record.id, () => deleteDownload(record.id));
        }
    };

    const removeAll = () => {
        if (!records.length) return;
        const confirmed = window.confirm(locale === 'fr'
            ? 'Supprimer tous les téléchargements de ce profil ?'
            : 'Remove every download for this profile?');
        if (confirmed) {
            void perform('all', () => clearDownloads({ profileId, userId }));
        }
    };

    return (
        <section className={styles.page} aria-labelledby='downloads-heading'>
            <header className={styles.heading}>
                <div>
                    <p>{locale === 'fr' ? 'Disponible sans réseau' : 'Available without a network'}</p>
                    <h1 id='downloads-heading'>{locale === 'fr' ? 'Téléchargements' : 'Downloads'}</h1>
                </div>
                {records.length > 0 && (
                    <button
                        disabled={Boolean(pendingId)}
                        onClick={removeAll}
                        type='button'
                    >
                        {locale === 'fr' ? 'Tout supprimer' : 'Remove all'}
                    </button>
                )}
            </header>

            <aside className={styles.storage}>
                <div>
                    <strong>{formatBytes(completedBytes)}</strong>
                    <span>{locale === 'fr' ? 'de médias enregistrés' : 'of saved media'}</span>
                </div>
                <div>
                    <strong>{formatBytes(storage?.availableBytes ?? null)}</strong>
                    <span>{locale === 'fr' ? 'estimés disponibles' : 'estimated available'}</span>
                </div>
                {storage && !storage.opfsSupported && (
                    <p role='alert'>
                        {locale === 'fr'
                            ? 'Ce navigateur ne prend pas en charge le stockage de vidéos hors ligne.'
                            : 'This browser does not support offline video storage.'}
                    </p>
                )}
                {storage?.opfsSupported && !storage.persisted && (
                    <button
                        onClick={() => void requestPersistentDownloadStorage()
                            .then(() => getDownloadStorageStatus())
                            .then(setStorage)}
                        type='button'
                    >
                        {locale === 'fr' ? 'Protéger le stockage' : 'Protect storage'}
                    </button>
                )}
            </aside>

            {loading && <p role='status'>{locale === 'fr' ? 'Chargement…' : 'Loading…'}</p>}
            {(error || actionError) && (
                <p className={styles.error} role='alert'>
                    {actionError || (locale === 'fr'
                        ? 'Les téléchargements sont indisponibles.'
                        : 'Downloads are unavailable.')}
                </p>
            )}
            {!loading && !records.length && (
                <div className={styles.empty}>
                    <h2>{locale === 'fr' ? 'Aucun téléchargement' : 'No downloads yet'}</h2>
                    <p>
                        {locale === 'fr'
                            ? 'Ouvrez un film ou un épisode et choisissez Télécharger.'
                            : 'Open a movie or episode and choose Download.'}
                    </p>
                    <Link to='/home'>{locale === 'fr' ? 'Parcourir le catalogue' : 'Browse the catalogue'}</Link>
                </div>
            )}

            <div className={styles.list}>
                {records.map(record => {
                    const percentage = record.totalBytes
                        ? Math.min(100, Math.round(record.bytesDownloaded / record.totalBytes * 100))
                        : null;
                    return (
                        <article className={styles.item} key={record.id}>
                            <div className={styles.itemCopy}>
                                <small>{episodeLabel(record) || record.itemType}</small>
                                <h2>{record.name}</h2>
                                <p>
                                    {record.status === 'completed'
                                        ? `${formatBytes(record.bytesDownloaded)} · ${locale === 'fr' ? 'Disponible hors ligne' : 'Available offline'}`
                                        : record.status === 'downloading'
                                            ? percentage === null
                                                ? locale === 'fr' ? 'Téléchargement…' : 'Downloading…'
                                                : `${percentage}% · ${formatBytes(record.bytesDownloaded)}`
                                            : record.status === 'paused'
                                                ? locale === 'fr' ? 'En pause' : 'Paused'
                                                : locale === 'fr' ? 'Échec du téléchargement' : 'Download failed'}
                                </p>
                                {record.status !== 'completed' && (
                                    <progress
                                        aria-label={locale === 'fr' ? 'Progression' : 'Progress'}
                                        max={record.totalBytes ?? 1}
                                        value={record.totalBytes ? record.bytesDownloaded : 0}
                                    />
                                )}
                                {record.error && <small className={styles.error}>{record.error}</small>}
                            </div>
                            <div className={styles.actions}>
                                {record.status === 'completed' && (
                                    <Link to={`/offline-watch/${record.id}`}>
                                        {locale === 'fr' ? 'Lire' : 'Play'}
                                    </Link>
                                )}
                                {record.status === 'downloading' && (
                                    <button
                                        disabled={pendingId === record.id}
                                        onClick={() => void perform(record.id, () => pause(record.id))}
                                        type='button'
                                    >
                                        {locale === 'fr' ? 'Pause' : 'Pause'}
                                    </button>
                                )}
                                {(record.status === 'paused' || record.status === 'failed') && (
                                    <button
                                        disabled={!online || pendingId === record.id}
                                        onClick={() => void perform(
                                            record.id,
                                            () => resume(record.id, { authHeaders: client.authHeaders() })
                                        )}
                                        type='button'
                                    >
                                        {locale === 'fr' ? 'Reprendre' : 'Resume'}
                                    </button>
                                )}
                                <button
                                    disabled={pendingId === record.id}
                                    onClick={() => remove(record)}
                                    type='button'
                                >
                                    {locale === 'fr' ? 'Supprimer' : 'Delete'}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
