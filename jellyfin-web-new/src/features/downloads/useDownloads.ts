import { useCallback, useEffect, useState } from 'react';

import {
    list,
    subscribe,
    type DownloadRecord
} from '../../downloads';

export function useDownloadRecords(userId: string, profileId: string) {
    const [ records, setRecords ] = useState<DownloadRecord[]>([]);
    const [ loading, setLoading ] = useState(true);
    const [ error, setError ] = useState<unknown>();

    const refresh = useCallback(async () => {
        try {
            setRecords(await list({ profileId, userId }));
            setError(undefined);
        } catch (cause) {
            setError(cause);
        } finally {
            setLoading(false);
        }
    }, [ profileId, userId ]);

    useEffect(() => {
        let active = true;
        const load = () => {
            void list({ profileId, userId }).then(
                value => {
                    if (!active) return;
                    setRecords(value);
                    setError(undefined);
                    setLoading(false);
                },
                cause => {
                    if (!active) return;
                    setError(cause);
                    setLoading(false);
                }
            );
        };
        load();
        const unsubscribe = subscribe(load);
        return () => {
            active = false;
            unsubscribe();
        };
    }, [ profileId, userId ]);

    return { error, loading, records, refresh };
}
