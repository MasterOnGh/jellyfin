import { expect, test } from '@playwright/test';

import { installSession, mockJellyfin } from './fixtures';

const media = Buffer.from(
    'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJREU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggI77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTMuMTAxV0GNTGF2ZjYyLjEzLjEwMUSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYjTMzmY7x2b1ZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBQLqBQJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTMuMTAxc3PWY8CLY8WI0zM5mO8dm9VnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QI/ngQCjqoEAAIDwAgCdASpAAEAAAEcIhYWIhYSIAgIABnA8QmAKsiD3MAD+/6tQgKOWgQDIANEBAAEQEAAYABhYL/QACI6AAKOWgQGQANEBAAEQEAAYABhYL/QACI6AAKOWgQJYANEBAAEQEAAYABhYL/QACI6AAKOWgQMgANEBAAEQEAAYABhYL/QACI6AABxTu2uRu4+zgQC3iveBAfGCAabwgQM=',
    'base64'
);

test('downloads, reloads and plays offline, then deletes the local copy', async ({
    context,
    page
}) => {
    test.skip(process.env.PLAYWRIGHT_PWA !== '1', 'Runs against the production PWA build.');

    await installSession(page, '');
    await mockJellyfin(page, true, '');
    await page.route('**/Items/item-aurora/PlaybackInfo', route =>
        route.fulfill({
            body: JSON.stringify({
                MediaSources: [{
                    Container: 'webm',
                    Id: 'source-offline',
                    MediaStreams: [{ Codec: 'vp8', Type: 'Video' }],
                    SupportsDirectPlay: true,
                    SupportsDirectStream: true,
                    SupportsTranscoding: false
                }],
                PlaySessionId: 'offline-session'
            }),
            contentType: 'application/json'
        }));
    await page.route('**/Videos/item-aurora/stream.webm?**', route => {
        const url = new URL(route.request().url());
        expect(url.searchParams.has('api_key')).toBe(false);
        expect(url.searchParams.has('access_token')).toBe(false);
        return route.fulfill({
            body: media,
            contentType: 'video/webm',
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(media.byteLength),
                ETag: '"offline-test"'
            }
        });
    });

    await page.goto('/#/profiles');
    await page.getByRole('button', { name: /Master/ }).click();
    await page.getByRole('link', { name: 'More info' }).click();
    await page.getByRole('button', { name: 'Download' }).click();
    await page.getByRole('link', { name: 'Downloads' }).click();

    await expect(page.getByRole('heading', { name: 'Aurora' })).toBeVisible();
    await expect(page.getByText(/Available offline/)).toBeVisible();

    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            await new Promise<void>(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
                    once: true
                });
            });
        }
    });

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Aurora' })).toBeVisible();

    await page.getByRole('link', { name: 'Play' }).click();
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(1);
    await video.evaluate(element => {
        element.currentTime = 0.5;
    });
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0);

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'No downloads yet' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No downloads yet' })).toBeVisible();
    await context.setOffline(false);
});
