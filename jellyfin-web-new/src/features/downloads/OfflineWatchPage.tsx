import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
    deleteDownload,
    get,
    getOfflineMediaUrl,
    readDownloadFile,
    subscribe,
    type DownloadRecord
} from '../../downloads';
import { playerStore } from '../../player';
import { useCatalog } from '../catalog/catalog';
import { useI18n } from '../../i18n';
import styles from './OfflineWatchPage.module.css';

const progressKey = (id: string) => `jellyfin-web-new:offline-progress:${id}`;

function savedPosition(id: string) {
    const value = Number(localStorage.getItem(progressKey(id)));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function mediaUrl(record: DownloadRecord) {
    const url = new URL(getOfflineMediaUrl(record.id), document.baseURI);
    if (record.mimeType?.startsWith('video/')) {
        url.searchParams.set('type', record.mimeType);
    }
    return url.toString();
}

export function OfflineWatchPage() {
    const { downloadId = '' } = useParams();
    const navigate = useNavigate();
    const { profileId, userId } = useCatalog();
    const { locale } = useI18n();
    const videoRef = useRef<HTMLVideoElement>(null);
    const objectUrlRef = useRef('');
    const lastStoredAt = useRef(0);
    const [ record, setRecord ] = useState<DownloadRecord>();
    const [ source, setSource ] = useState('');
    const [ error, setError ] = useState('');
    const [ loading, setLoading ] = useState(true);

    useEffect(() => {
        let active = true;
        const load = () => {
            void get(downloadId).then(value => {
                if (!active) return;
                if (!value
                    || value.status !== 'completed'
                    || value.userId !== userId
                    || value.profileId !== profileId) {
                    setRecord(undefined);
                    setError(locale === 'fr'
                        ? 'Ce téléchargement est introuvable ou appartient à un autre profil.'
                        : 'This download is missing or belongs to another profile.');
                    setLoading(false);
                    return;
                }
                setRecord(value);
                setError('');
                setLoading(false);
            }, () => {
                if (!active) return;
                setError(locale === 'fr'
                    ? 'Le stockage hors ligne est indisponible.'
                    : 'Offline storage is unavailable.');
                setLoading(false);
            });
        };
        load();
        const unsubscribe = subscribe(load);
        return () => {
            active = false;
            unsubscribe();
        };
    }, [ downloadId, locale, profileId, userId ]);

    useEffect(() => {
        if (!record) return;
        if (navigator.serviceWorker?.controller) return;
        let active = true;
        void readDownloadFile(record.id).then(file => {
            if (!active) return;
            if (!file) {
                setError(locale === 'fr'
                    ? 'Le fichier téléchargé a été supprimé du stockage.'
                    : 'The downloaded file was removed from storage.');
                return;
            }
            const objectUrl = URL.createObjectURL(file);
            objectUrlRef.current = objectUrl;
            setSource(objectUrl);
        });
        return () => {
            active = false;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = '';
            }
        };
    }, [ locale, record ]);

    useEffect(() => () => playerStore.reset(), []);

    const playbackSource = source
        || (record && navigator.serviceWorker?.controller ? mediaUrl(record) : '');

    const fallbackToFile = async () => {
        if (!record || playbackSource.startsWith('blob:')) {
            setError(locale === 'fr'
                ? 'Ce fichier n’est pas lisible par ce navigateur.'
                : 'This file cannot be played by this browser.');
            playerStore.set({ error: 'codec', status: 'error' });
            return;
        }
        const file = await readDownloadFile(record.id).catch(() => null);
        if (!file) {
            setError(locale === 'fr'
                ? 'Le fichier téléchargé est introuvable.'
                : 'The downloaded file is missing.');
            return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = URL.createObjectURL(file);
        setSource(objectUrlRef.current);
    };

    const remove = async () => {
        if (!record) return;
        const confirmed = window.confirm(locale === 'fr'
            ? `Supprimer « ${record.name} » de cet appareil ?`
            : `Remove “${record.name}” from this device?`);
        if (!confirmed) return;
        videoRef.current?.pause();
        await deleteDownload(record.id);
        localStorage.removeItem(progressKey(record.id));
        navigate('/downloads', { replace: true });
    };

    if (loading) {
        return <main className={styles.state}><p role='status'>{locale === 'fr' ? 'Chargement…' : 'Loading…'}</p></main>;
    }
    if (!record || error) {
        return (
            <main className={styles.state}>
                <p role='alert'>{error}</p>
                <button onClick={() => navigate('/downloads')} type='button'>
                    {locale === 'fr' ? 'Retour aux téléchargements' : 'Back to downloads'}
                </button>
            </main>
        );
    }

    return (
        <main className={styles.page} aria-label={record.name}>
            <video
                autoPlay
                controls
                playsInline
                ref={videoRef}
                src={playbackSource}
                onEnded={() => {
                    localStorage.removeItem(progressKey(record.id));
                    playerStore.set({ status: 'ended' });
                }}
                onError={() => void fallbackToFile()}
                onLoadedMetadata={event => {
                    const position = savedPosition(record.id);
                    if (position > 0 && position < event.currentTarget.duration - 5) {
                        event.currentTarget.currentTime = position;
                    }
                    playerStore.set({
                        currentTime: event.currentTarget.currentTime,
                        duration: event.currentTarget.duration || 0,
                        item: {
                            Id: record.itemId,
                            Name: record.name,
                            ...(record.runtimeTicks === undefined
                                ? {}
                                : { RunTimeTicks: record.runtimeTicks }),
                            ...(record.itemType === undefined
                                ? {}
                                : { Type: record.itemType })
                        },
                        profileId,
                        status: 'paused'
                    });
                }}
                onPause={() => playerStore.set({ status: 'paused' })}
                onPlay={() => playerStore.set({ status: 'playing' })}
                onTimeUpdate={event => {
                    playerStore.set({ currentTime: event.currentTarget.currentTime });
                    const now = Date.now();
                    if (now - lastStoredAt.current >= 5_000) {
                        localStorage.setItem(progressKey(record.id), String(event.currentTarget.currentTime));
                        lastStoredAt.current = now;
                    }
                }}
            />
            <header className={styles.top}>
                <button onClick={() => navigate('/downloads')} type='button' aria-label={locale === 'fr' ? 'Retour' : 'Back'}>
                    ←
                </button>
                <div>
                    <small>{locale === 'fr' ? 'Lecture hors ligne' : 'Offline playback'}</small>
                    <h1>{record.name}</h1>
                </div>
                <button onClick={() => void remove()} type='button'>
                    {locale === 'fr' ? 'Supprimer' : 'Delete'}
                </button>
            </header>
        </main>
    );
}
