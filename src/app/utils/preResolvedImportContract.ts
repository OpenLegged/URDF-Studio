import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';

export interface PreResolvedImportEntry {
  fileName: string;
  format: RobotFile['format'];
  contentSignature: string;
  result: RobotImportResult;
}
