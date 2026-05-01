import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { LinkRotationController } from './link-rotation.js';

function createRenderInterface() {
    return {
        meshes: {
            '/Robot/arm_link/visuals.proto_mesh_id0': {},
        },
    };
}

test('LinkRotationController schedules joint catalog builds and reports ready on success', async () => {
    const controller = new LinkRotationController();
    controller.setRenderInterface(createRenderInterface());
    controller.buildJointCatalog = async function () {
        this.jointCatalogByLinkPath.set('/Robot/arm_link', {
            linkPath: '/Robot/arm_link',
        });
    };

    const buildPromise = controller.startJointCatalogBuildIfNeeded();

    assert.ok(buildPromise instanceof Promise);
    await buildPromise;

    assert.equal(controller.jointCatalogStatus, 'ready');
    assert.equal(controller.jointCatalogError, null);
    assert.equal(controller.jointCatalogBuildPromise, null);
    assert.equal(controller.jointCatalogByLinkPath.size, 1);
});

test('LinkRotationController exposes build failures as catalog errors', async () => {
    const controller = new LinkRotationController();
    controller.setRenderInterface(createRenderInterface());
    controller.buildJointCatalog = async function () {
        throw new Error('joint-catalog-build-failed');
    };

    await assert.rejects(
        controller.startJointCatalogBuildIfNeeded(),
        /joint-catalog-build-failed/,
    );

    assert.equal(controller.jointCatalogStatus, 'error');
    assert.equal(controller.jointCatalogError, 'joint-catalog-build-failed');
    assert.equal(controller.jointCatalogBuildPromise, null);
});

test('LinkRotationController does not swallow joint catalog readiness failures', async () => {
    const controller = new LinkRotationController();
    controller.startJointCatalogBuildIfNeeded = () => Promise.reject(new Error('joint-ready-failed'));

    await assert.rejects(
        controller.ensureJointCatalogReady(),
        /joint-ready-failed/,
    );
});

test('LinkRotationController logs joint catalog readiness timeouts instead of silently continuing', async () => {
    const controller = new LinkRotationController();
    controller.jointCatalogStatus = 'loading';
    controller.jointCatalogError = 'still-building';
    controller.stageSourcePath = '/robots/timed_out_joint_catalog.usd';
    controller.startJointCatalogBuildIfNeeded = () => new Promise(() => { });

    const originalWindow = globalThis.window;
    const originalConsoleWarn = console.warn;
    const loggedWarnings = [];
    globalThis.window = {
        setTimeout,
        clearTimeout,
    };
    console.warn = (...args) => {
        loggedWarnings.push(args);
    };

    try {
        await controller.ensureJointCatalogReady({ maxWaitMs: 1 });
    }
    finally {
        console.warn = originalConsoleWarn;
        globalThis.window = originalWindow;
    }

    assert.equal(loggedWarnings.length, 1);
    assert.match(String(loggedWarnings[0]?.[0] || ''), /Joint catalog readiness wait timed out/);
    assert.deepEqual(loggedWarnings[0]?.[1], {
        waitedMs: 1,
        jointCatalogStatus: 'loading',
        jointCatalogError: 'still-building',
        stageSourcePath: '/robots/timed_out_joint_catalog.usd',
    });
});

test('LinkRotationController keeps joint catalog prewarm failures off the console', async () => {
    const controller = new LinkRotationController();
    controller.ensureJointCatalogBuildScheduled = () => {};
    controller.ensureJointCatalogReady = async () => {
        throw new Error('joint-catalog-prewarm-failed');
    };

    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        await controller.prewarmJointCatalog();
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 0);
});

test('LinkRotationController keeps joint pose prewarm failures off the console', () => {
    const controller = new LinkRotationController();
    controller.enabled = true;
    controller.renderInterface = createRenderInterface();
    controller.apply = () => {
        throw new Error('joint-pose-prewarm-failed');
    };

    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        controller.prewarmJointPosePipeline();
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 0);
});

test('LinkRotationController surfaces cached metadata getter failures as catalog build errors', async () => {
    const controller = new LinkRotationController();
    controller.setRenderInterface({
        meshes: {
            '/Robot/arm_link/visuals.proto_mesh_id0': {},
        },
        getCachedRobotMetadataSnapshot() {
            throw new Error('cached-metadata-crashed');
        },
    });
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        await assert.rejects(
            controller.startJointCatalogBuildIfNeeded(),
            /Failed to read cached render robot metadata snapshot/,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(controller.jointCatalogStatus, 'error');
    assert.match(String(controller.jointCatalogError || ''), /Failed to read cached render robot metadata snapshot/);
    assert.ok(
        loggedErrors.some((entry) => /Failed to read cached render robot metadata snapshot/.test(String(entry?.[0] || ''))),
    );
});

test('LinkRotationController does not clamp existing joint angle when catalog limits refresh', () => {
    const controller = new LinkRotationController();
    controller.linkJointStateByLinkPath.set('/Robot/leg_link', {
        linkPath: '/Robot/leg_link',
        jointPath: '/Robot/joints/leg_joint',
        parentLinkPath: '/Robot/base_link',
        axisToken: 'X',
        axisLocal: new Vector3(1, 0, 0),
        lowerLimitDeg: -180,
        upperLimitDeg: 180,
        angleDeg: 0,
        localPivotInLink: null,
    });

    controller.applyJointCatalogEntry({
        linkPath: '/Robot/leg_link',
        jointPath: '/Robot/joints/leg_joint',
        parentLinkPath: '/Robot/base_link',
        axisToken: 'X',
        axisLocal: new Vector3(1, 0, 0),
        lowerLimitDeg: 10,
        upperLimitDeg: 20,
        localPivotInLink: null,
    });

    assert.equal(controller.linkJointStateByLinkPath.get('/Robot/leg_link')?.angleDeg, 0);
});
