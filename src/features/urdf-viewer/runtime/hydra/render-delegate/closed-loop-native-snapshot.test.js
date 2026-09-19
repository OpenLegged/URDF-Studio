import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

for (const metadataLocation of ['metadata', 'physics']) {
    test(`native scene normalization retains closed loops from ${metadataLocation} without changing the tree`, () => {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => null,
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.buildRobotMetadataSnapshotForStage = () => {
            throw new Error('Complete native metadata must not require a text fallback');
        };
        const jointCatalogEntries = [{
            jointName: 'right_tip_fixed',
            jointType: 'fixed',
            parentLinkPath: '/Robot/right_arm',
            childLinkPath: '/Robot/right_tip',
        }];
        const linkParentPairs = [['/Robot/right_tip', '/Robot/right_arm']];
        const closedLoopConstraintEntries = [{
            id: 'bridge',
            constraintType: 'joint',
            jointType: 'revolute',
            linkAPath: '/Robot/left_tip',
            linkBPath: '/Robot/right_tip',
            anchorLocalA: [0.1, 0.2, 0.3],
            anchorLocalB: [0.4, 0.5, 0.6],
            axisLocal: [-1, 2, -3],
            originXyz: [0.7, 0.8, 0.9],
            originQuatWxyz: [0.5, 0.5, 0.5, 0.5],
            lowerLimitDeg: -45,
            upperLimitDeg: 90,
        }];
        const rawSnapshot = {
            stage: { stageSourcePath: '/loop.usd', defaultPrimPath: '/Robot' },
            robotTree: { jointCatalogEntries, linkParentPairs },
            physics: { linkDynamicsEntries: [], closedLoopConstraintEntries },
            render: { meshDescriptors: [], materials: [] },
            ...(metadataLocation === 'metadata' ? {
                robotMetadataSnapshot: {
                    source: 'usd-stage-cpp',
                    jointCatalogEntries,
                    linkParentPairs,
                    closedLoopConstraintEntries,
                },
            } : {}),
        };
        const snapshot = delegate.normalizeRobotSceneSnapshot(rawSnapshot);
        assert.deepEqual(snapshot.robotMetadataSnapshot.closedLoopConstraintEntries, closedLoopConstraintEntries);
        assert.deepEqual(snapshot.physics.closedLoopConstraintEntries, closedLoopConstraintEntries);
        assert.deepEqual(snapshot.robotTree.jointCatalogEntries, jointCatalogEntries);
        assert.deepEqual(snapshot.robotTree.linkParentPairs, linkParentPairs);
        assert.deepEqual(
            delegate.getCachedRobotMetadataSnapshot('/loop.usd').closedLoopConstraintEntries,
            closedLoopConstraintEntries,
        );
    });
}
