import { ApiError } from './apiClient.js';
import { listModelSummaries, resolveEntry } from './catalog.js';
/**
 * The catalog contains every documented endpoint. This Plugin deliberately
 * exposes the selected task scope instead of treating every media entry as a
 * supported workflow. These entries are excluded or return non-media results
 * that the file-delivery workflow cannot expose correctly.
 */
const EXCLUDED_MODELS = {
    'phota-image-enhance': 'A3 image enhancement is outside the selected image scope.',
    'patina-material': 'A4 material generation is outside the selected image scope.',
    'patina-material-extract': 'A5 material extraction is outside the selected image scope.',
    'patina-pbr-maps': 'A6 PBR map generation is outside the selected image scope.',
    'phota-create-profile': 'A7 profile creation is outside the selected image scope.',
    'sora-2-character': 'Sora character creation is explicitly excluded.',
    'topaz-upscale-video': 'Video upscaling and interpolation (B10) are explicitly excluded from this Plugin.',
    'veed-subtitles': 'Subtitle generation/import/translation/style tasks are outside the selected C scope.',
    'heygen-video-agent': 'Prompt-driven HeyGen video (C3) is outside the selected digital-human scope.',
    'fabric-1.0-text': 'Text-driven avatar video (C3) is outside the selected digital-human scope.',
    'live-avatar': 'Prompt-driven avatar video is outside the selected digital-human scope.',
    'kling-video-create-voice': 'Voice creation is outside the selected media workflows.',
};
export const PREFERRED_MODELS = {
    image: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
    video: [
        'seedance-2.5-text-to-video', 'seedance-2.5-image-to-video',
        'seedance-2.5-reference-to-video',
    ],
    audio: ['speech-2.8-hd', 'paraformer-v2'],
    document: ['doc2x-v3'],
    understanding: ['gemini-3.1-pro-preview', 'gemini-3.5-flash'],
};
/** 首轮实测使用的数字人默认模型；其余 C1/C2 型号仍需显式选择。 */
export const VIDEO_DEFAULT_MODELS = {
    generation: PREFERRED_MODELS.video,
    c1: ['lipsync-2'],
    c2: ['omnihuman-1.5'],
};
const VIDEO_DEFAULT_SET = new Set([
    ...VIDEO_DEFAULT_MODELS.generation,
    ...VIDEO_DEFAULT_MODELS.c1,
    ...VIDEO_DEFAULT_MODELS.c2,
]);
const LEGACY_SEEDANCE_MODELS = new Set([
    'seedance-2.0-text-to-video', 'seedance-2.0-image-to-video',
    'seedance-2.0-reference-to-video', 'seedance-2.0-fast-text-to-video',
    'seedance-2.0-fast-image-to-video', 'seedance-2.0-fast-reference-to-video',
]);
const VIDEO_SCOPE_MODELS = new Set([
    ...PREFERRED_MODELS.video,
    ...LEGACY_SEEDANCE_MODELS,
    'lipsync-2', 'lipsync-2-pro', 'sync-3',
    'fabric-1.0', 'fabric-1.0-fast', 'omnihuman-1.5', 'creatify-aurora',
]);
function excludedModel(model) {
    return EXCLUDED_MODELS[model];
}
function capabilityForModel(model, media) {
    if (media === 'image')
        return 'A1/A2';
    if (media === 'video' && ['lipsync-2', 'lipsync-2-pro', 'sync-3'].includes(model))
        return 'C1';
    if (media === 'video' && ['fabric-1.0', 'fabric-1.0-fast', 'omnihuman-1.5', 'creatify-aurora'].includes(model))
        return 'C2';
    if (media === 'video' && model === 'seedance-2.5-text-to-video')
        return 'text-to-video';
    if (media === 'video' && model === 'seedance-2.5-image-to-video')
        return 'starting-frame image-to-video';
    if (media === 'video' && model === 'seedance-2.5-reference-to-video')
        return 'reference-to-video';
    if (media === 'video' && LEGACY_SEEDANCE_MODELS.has(model)) {
        const mode = model.endsWith('-text-to-video') ? 'text-to-video'
            : model.endsWith('-image-to-video') ? 'image-to-video' : 'reference-to-video';
        return `Seedance 2.0 ${mode} (explicit selection)`;
    }
    if (media === 'audio' && model === 'paraformer-v2')
        return 'D1 ASR';
    if (media === 'audio')
        return 'D1 TTS/music';
    if (media === 'document')
        return 'E2';
    return 'D (legacy audio workflow)';
}
function supported(model, entry) {
    if (excludedModel(model))
        return false;
    if (entry.mediaType === 'video' && !VIDEO_SCOPE_MODELS.has(model))
        return false;
    return ['image', 'video', 'document'].includes(entry.mediaType || '') ||
        entry.mediaType === 'audio';
}
export function modelEntry(model) {
    const found = resolveEntry(model);
    const excluded = excludedModel(model);
    if (excluded)
        throw new Error(`Model ${model} is not exposed by this Plugin: ${excluded}`);
    if (found?.entry.mediaType === 'video' && !VIDEO_SCOPE_MODELS.has(model)) {
        throw new Error(`Video model ${model} is not exposed for new generation by this Plugin. Video generation defaults to Seedance 2.5 text, starting-frame, or reference modes; Seedance 2.0 variants remain available for explicit selection, alongside the C1/C2 digital-human models. Existing task IDs and records can still be queried or resumed.`);
    }
    if (!found || !supported(model, found.entry))
        throw new Error('No supported generation schema for this model. Use models and describe; this release supports the selected image, video, digital-human, music and TTS workflows.');
    if (found.entry.method.toUpperCase() !== 'POST' || !/^\/v1\/(images|videos|audios|audio|run)\/generations$/.test(found.entry.path))
        throw new Error('Unsupported catalog generation endpoint.');
    return found;
}
export async function models(client, media, keyword) {
    if (media === 'understanding') {
        try {
            const available = await client.listLlmModels();
            const kw = keyword?.toLowerCase();
            const rows = available
                .filter(item => !kw || `${item.id} ${(item.capabilities ?? []).join(' ')}`.toLowerCase().includes(kw))
                .map(item => ({ model: item.id, media: 'llm', capabilities: item.capabilities ?? [], preferred: PREFERRED_MODELS.understanding.includes(item.id), default: PREFERRED_MODELS.understanding.includes(item.id) }));
            return { status: 'ok', availability_known: true, models: rows, catalog_only: [], preferred_models: PREFERRED_MODELS.understanding,
                note: 'E1 uses the separate /v1/configs/llm_generations_models registry. Only models declaring the requested media capability may be submitted; pure text is excluded.' };
        }
        catch (error) {
            return { status: 'availability_unknown', availability_known: false, models: [], catalog_only: [], error: error.message,
                ...(error instanceof ApiError ? { failure: { http_status: error.status, ambiguous: error.ambiguous } } : {}) };
        }
    }
    const catalog = listModelSummaries({ mediaType: media, keyword }).filter(row => {
        const found = resolveEntry(row.model);
        return found && supported(row.model, found.entry);
    });
    try {
        const live = await client.listLiveModels();
        const rows = [];
        const mapped = new Set();
        for (const id of live.keys()) {
            const found = resolveEntry(id);
            if (!found || !supported(id, found.entry))
                continue;
            mapped.add(found.catalogModel);
            if (media && found.entry.mediaType !== media)
                continue;
            if (keyword && !`${id} ${found.entry.title} ${found.entry.summary}`.toLowerCase().includes(keyword.toLowerCase()))
                continue;
            const preferred = found.entry.mediaType === 'image'
                ? PREFERRED_MODELS.image.includes(id)
                : found.entry.mediaType === 'video'
                    ? PREFERRED_MODELS.video.includes(id)
                    : found.entry.mediaType === 'audio'
                        ? PREFERRED_MODELS.audio.includes(id)
                        : found.entry.mediaType === 'document'
                            ? PREFERRED_MODELS.document.includes(id)
                            : false;
            rows.push({ model: id, media: found.entry.mediaType, title: found.entry.title, catalog_model: found.catalogModel, preferred,
                default: (found.entry.mediaType === 'image' && id === 'gpt-image-2.5-flare') ||
                    (found.entry.mediaType === 'video' && VIDEO_DEFAULT_SET.has(id)) ||
                    (found.entry.mediaType === 'audio' && PREFERRED_MODELS.audio.includes(id)) ||
                    (found.entry.mediaType === 'document' && id === 'doc2x-v3') });
        }
        return { status: 'ok', availability_known: true, models: rows, catalog_only: catalog.filter(row => !mapped.has(row.model)),
            preferred_models: media ? (PREFERRED_MODELS[media] ?? []) : PREFERRED_MODELS,
            note: 'Listed model IDs are visible to this key; a working generation channel is not guaranteed. preferred marks built-in recommendations, not the configured model order. Read model_selection for current configuration and use plan for task-specific candidates. run and continue follow the saved fallback policy and preserve all input requirements; no model is appended automatically. Explicit user model choices remain fixed. Legacy single-model commands do not perform fallback.' };
    }
    catch (error) {
        return { status: 'availability_unknown', availability_known: false, models: [], catalog_only: catalog, error: error.message,
            ...(error instanceof ApiError ? { failure: { http_status: error.status, ambiguous: error.ambiguous } } : {}) };
    }
}
export function describe(model) {
    const { entry, catalogModel, match } = modelEntry(model);
    const params = entry.paramSpecs.map((field) => field.name === 'model'
        ? { ...field, default: model, description: `${field.description ?? ''}\nSelected model ID: ${model}.` }
        : field);
    return { status: 'ok', model, media: entry.mediaType, endpoint: `POST ${entry.path}`,
        catalog_model: catalogModel, match, title: entry.title, params,
        required_params: entry.requiredParams, conditionally_required_params: entry.conditionalRequiredParams ?? [],
        capability: capabilityForModel(model, entry.mediaType),
        note: 'This is bundled schema information, not proof of model availability. Keep the exact ID returned by models. ' +
            (catalogModel === 'seedance-2.5-reference-to-video'
                ? 'Provide at least one nonempty reference array; image_urls, video_urls and audio_urls may be combined.'
                : 'Conditional requirements belong to alternative modes; do not fill all of them.') };
}
export function validateGeneration(media, model, params) {
    const { entry, catalogModel } = modelEntry(model);
    if (entry.mediaType !== media)
        throw new Error(`This model belongs to ${entry.mediaType}, not ${media}.`);
    if ('model' in params && params.model !== model)
        throw new Error('params.model conflicts with --model. Keep model only in --model.');
    for (const field of entry.paramSpecs) {
        if (field.name === 'model')
            continue;
        const value = params[field.name];
        if (value === undefined) {
            if (field.required)
                throw new Error(`Missing required parameter: ${field.name}`);
            continue;
        }
        if (field.required && (value === null || value === '' || (Array.isArray(value) && value.length === 0)))
            throw new Error(`Required parameter is empty: ${field.name}`);
        if (value === null && !field.required)
            continue;
        if (field.enum && !field.enum.includes(value))
            throw new Error(`Invalid enum value for ${field.name}; use describe.`);
        if (field.type === 'string' && typeof value !== 'string')
            throw new Error(`${field.name} must be a string.`);
        if (field.type === 'array' && !Array.isArray(value))
            throw new Error(`${field.name} must be an array.`);
        if (Array.isArray(value) && field.items) {
            for (const item of value) {
                const valid = field.items === 'integer' ? Number.isInteger(item)
                    : field.items === 'number' ? typeof item === 'number' && Number.isFinite(item)
                        : field.items === 'object' ? item !== null && typeof item === 'object' && !Array.isArray(item)
                            : ['string', 'boolean'].includes(field.items) ? typeof item === field.items : true;
                if (!valid)
                    throw new Error(`${field.name} items must have type ${field.items}.`);
            }
        }
        if (field.type === 'boolean' && typeof value !== 'boolean')
            throw new Error(`${field.name} must be boolean.`);
        if (field.type === 'integer' && !Number.isInteger(value))
            throw new Error(`${field.name} must be an integer.`);
        if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
            throw new Error(`${field.name} must be a finite number.`);
        if (field.type === 'object' && (typeof value !== 'object' || Array.isArray(value)))
            throw new Error(`${field.name} must be an object.`);
    }
    if (PREFERRED_MODELS.image.includes(catalogModel))
        validateImage25(params);
    if (PREFERRED_MODELS.video.includes(catalogModel))
        validateSeedance25(catalogModel, entry, params);
    return entry.path;
}
// These checks follow the Gateway's model schemas. Keep them model-specific:
// other catalog entries have different nullable fields and input conventions.
const IMAGE_25_RESOLUTIONS = new Set([
    'auto', '1024x768', '768x1024', '1024x1024', '1536x1024', '1024x1536',
    '1920x1080', '1080x1920', '2560x1440', '1440x2560', '3840x2160', '2160x3840',
]);
function validateImage25(params) {
    for (const field of ['num_outputs', 'resolution', 'quality', 'output_format', 'background']) {
        if (params[field] === null)
            throw new Error(`${field} cannot be null; omit it to use the default.`);
    }
    if (params.num_outputs !== undefined && (Number(params.num_outputs) < 1 || Number(params.num_outputs) > 10)) {
        throw new Error('num_outputs must be an integer between 1 and 10.');
    }
    const resolution = params.resolution;
    if (resolution !== undefined) {
        if (typeof resolution === 'string') {
            if (!IMAGE_25_RESOLUTIONS.has(resolution))
                throw new Error('resolution must be a documented preset, auto, or a width/height object; use describe.');
        }
        else {
            if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution))
                throw new Error('resolution must be a preset string or a width/height object.');
            const { width, height } = resolution;
            if (!Number.isInteger(width) || !Number.isInteger(height))
                throw new Error('resolution.width and resolution.height must be integers.');
            const w = width;
            const h = height;
            if (w % 16 !== 0 || h % 16 !== 0 || w < 256 || w > 3840 || h < 256 || h > 3840) {
                throw new Error('resolution.width and resolution.height must be multiples of 16 between 256 and 3840.');
            }
            if (w * h < 655_360 || w * h > 8_294_400)
                throw new Error('resolution total pixels must be between 655360 and 8294400.');
            if (Math.max(w, h) / Math.min(w, h) > 3)
                throw new Error('resolution long/short edge ratio must not exceed 3:1.');
        }
    }
    if (Array.isArray(params.image_urls) && params.image_urls.some(url => typeof url !== 'string' || !url.trim())) {
        throw new Error('image_urls items must be nonempty strings.');
    }
    if (typeof params.mask_url === 'string') {
        if (!params.mask_url.trim())
            throw new Error('mask_url must be a nonempty string.');
        if (!Array.isArray(params.image_urls) || !params.image_urls.length)
            throw new Error('mask_url requires image_urls; the mask applies to the first reference image.');
    }
    if (params.background === 'transparent' && params.output_format === 'jpeg') {
        throw new Error('transparent background requires png or webp output_format.');
    }
}
function validateSeedance25(model, entry, params) {
    const allowed = new Set(entry.params);
    for (const [field, value] of Object.entries(params)) {
        if (!allowed.has(field))
            throw new Error(`${field} is not supported by ${model}; use describe for this input mode.`);
        if (value === null)
            throw new Error(`${field} cannot be null; omit optional fields to use their defaults.`);
    }
    if (typeof params.prompt === 'string' && !params.prompt.trim())
        throw new Error('prompt must be a nonempty string.');
    const duration = params.duration ?? 5;
    if (!Number.isInteger(duration) || Number(duration) < 4 || Number(duration) > 30)
        throw new Error('duration must be an integer between 4 and 30 seconds.');
    if (params.resolution === '1080p' && ![5, 10, 30].includes(Number(duration)))
        throw new Error('Seedance 2.5 at 1080p supports duration 5, 10, or 30 seconds.');
    if (model === 'seedance-2.5-image-to-video' && typeof params.image_url === 'string' && !params.image_url.trim()) {
        throw new Error('image_url must be a nonempty starting-frame image URL.');
    }
    if (model === 'seedance-2.5-reference-to-video') {
        let references = 0;
        for (const [field, maximum] of [['image_urls', 30], ['video_urls', 10], ['audio_urls', 10]]) {
            const urls = params[field];
            if (!Array.isArray(urls))
                continue; // Field types are checked above.
            if (urls.some(url => typeof url !== 'string' || !url.trim()))
                throw new Error(`${field} items must be nonempty strings.`);
            if (urls.length > maximum)
                throw new Error(`${field} must not exceed ${maximum} items.`);
            references += urls.length;
        }
        if (!references)
            throw new Error('reference-to-video requires at least one image_urls, video_urls, or audio_urls item.');
    }
}
