/**
 * Motor Library - Default motor specifications from various manufacturers
 * Used in Hardware mode for joint motor configuration
 */
import type { MotorSpec } from '@/types';

export const DEFAULT_MOTOR_LIBRARY: Record<string, MotorSpec[]> = {
  'Unitree': [
    {
        name: 'Go1-M8010-6',
        armature: 0.000111842,
        velocity: 30.1,
        effort: 23.7,
        url: 'https://shop.unitree.com/',
        description: 'Standard motor for Unitree Go1 quadruped.'
    },
    {
        name: 'A1-8010',
        armature: 0.000636383,
        velocity: 21,
        effort: 33.5,
        url: 'https://shop.unitree.com/',
        description: 'Motor for Unitree A1.'
    },
    {
        name: 'B1-10010',
        armature: 0.0011969,
        velocity: 19.69,
        effort: 91.0035,
        url: 'https://shop.unitree.com/',
        description: 'Heavy duty motor for Unitree B1.'
    },
  ],
  'RobStride': [
    {
        name: 'RS_00',
        armature: 0.001,
        velocity: 32.9,
        effort: 14,
        url: 'https://www.robstride.com/products/robStride00/',
        description: 'Motor for RobStride 00 .'
    },
    {
        name: 'RS_01',
        armature: 0.0042,
        velocity: 32.9,
        effort: 17,
        url: 'https://www.robstride.com/products/robStride01/',
        description: 'Motor for RobStride 01.'
    },
    {
        name: 'RS_02',
        armature: 0.0042,
        velocity: 42.9,
        effort: 17,
        url: 'https://www.robstride.com/products/robStride02/',
        description: 'Motor for RobStride 02.'
    },
    {
        name: 'RS_03',
        armature: 0.02,
        velocity: 20.9,
        effort: 60,
        url: 'https://www.robstride.com/products/robStride03/',
        description: 'Motor for RobStride 03.'
    },
    {
        name: 'RS_04',
        armature: 0.04,
        velocity: 20.9,
        effort: 120,
        url: 'https://www.robstride.com/products/robStride04/',
        description: 'Motor for RobStride 04.'
    },
    {
        name: 'RS_05',
        armature: 0.0007,
        velocity: 50.2,
        effort: 5.5,
        url: 'https://www.robstride.com/products/robStride05/',
        description: 'Motor for RobStride 05.'
    },
    {
        name: 'RS_06',
        armature: 0.012,
        velocity: 50.2,
        effort: 36,
        url: 'https://www.robstride.com/products/robStride06/',
        description: 'Motor for RobStride 06.'
    },
    {
        name: 'EL_05',
        armature: 0.000944,
        velocity: 45.0,
        effort: 6,
        url: 'https://www.robstride.com/products/eduLite05/',
        description: 'Motor for RobStride EDULITE 05.'
    }
],
  'DAMIAO': [
    {
        name: 'DM-J3507-2EC',
        armature: 0.0000087,
        velocity: 48.168,
        effort: 3,
        url: 'https://gitee.com/kit-miao/DM-J3507-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4310-2EC V1.1',
        armature: 0.000018,
        velocity: 20.944,
        effort: 7,
        url: 'https://gitee.com/kit-miao/DM-J4310-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4310-2EC V1.1(48V)',
        armature: 0.000018,
        velocity: 41.888,
        effort: 7,
        url: 'https://gitee.com/kit-miao/DM-J4310-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4310P-2EC V1.1',
        armature: 0.000019,
        velocity: 20.944,
        effort: 12.5,
        url: 'https://gitee.com/kit-miao/dm-j4310-p-2-ec',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4310P-2EC V1.1(48V)',
        armature: 0.000019,
        velocity: 47.124,
        effort: 12.5,
        url: 'https://gitee.com/kit-miao/dm-j4310-p-2-ec',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4340-2EC',
        armature: 0.00002,
        velocity: 5.498,
        effort: 27,
        url: 'https://gitee.com/kit-miao/DM-J4340-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4340-2EC(48V)',
        armature: 0.00002,
        velocity: 10.472,
        effort: 27,
        url: 'https://gitee.com/kit-miao/DM-J4340-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4340P-2EC',
        armature: 0.00002,
        velocity: 5.498,
        effort: 27,
        url: 'https://gitee.com/kit-miao/DM-J4340P-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J4340P-2EC(48V)',
        armature: 0.00002,
        velocity: 10.472,
        effort: 27,
        url: 'https://gitee.com/kit-miao/DM-J4340P-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J6006-2EC',
        armature: 0.000058,
        velocity: 23.667,
        effort: 11,
        url: 'https://gitee.com/kit-miao/DM-J6006-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J6248P-2EC',
        armature: 0.000054,
        velocity: 6.283,
        effort: 97,
        url: 'https://gitee.com/kit-miao/DM-J6248P-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J8006-2EC V1.1',
        armature: 0.000115,
        velocity: 20.334,
        effort: 20,
        url: 'https://gitee.com/kit-miao/DM-J8006-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J8009-2EC',
        armature: 0.000195,
        velocity: 17.593,
        effort: 40,
        url: 'https://gitee.com/kit-miao/DM-J8009-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J8009P-2EC',
        armature: 0.000195,
        velocity: 17.593,
        effort: 40,
        url: 'https://gitee.com/kit-miao/DM-J8009P-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J10010-2EC',
        armature: 0.00055,
        velocity: 7.854,
        effort: 150,
        url: 'https://gitee.com/kit-miao/DM-J10010-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-J10010L-2EC',
        armature: 0.000556,
        velocity: 10.472,
        effort: 120,
        url: 'https://gitee.com/kit-miao/DM-J10010L-2EC',
        description: 'DM Joint Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-S3519-1EC',
        armature: 0.000018,
        velocity: 45.553,
        effort: 7.8,
        url: 'https://gitee.com/kit-miao/DM-S3519-1EC',
        description: 'DM Separation Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-S2325-1EC',
        armature: 0.000038,
        velocity: 58.643,
        effort: 5,
        url: 'https://gitee.com/kit-miao/dm-s2325-1-ec',
        description: 'DM Separation Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-H6215',
        armature: 0.00018,
        velocity: 33.51,
        effort: 2,
        url: 'https://gitee.com/kit-miao/DM-H6215',
        description: 'DM Hub Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-H3510',
        armature: 0.0000174,
        velocity: 188.496,
        effort: 0.45,
        url: 'https://gitee.com/kit-miao/DM-H3510',
        description: 'DM Hub Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-H65',
        armature: 0.00168,
        velocity: 27.227,
        effort: 21.5,
        url: 'https://gitee.com/kit-miao/DM-H65-1EC',
        description: 'DM Hub Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-G6220',
        armature: 0.000125,
        velocity: 31.416,
        effort: 2.45,
        url: 'https://gitee.com/kit-miao/DM-G6220',
        description: 'DM Hollow Shaft Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-JH11-51-2EC',
        armature: 0.0000063,
        velocity: 6.283,
        effort: 7.8,
        url: 'https://gitee.com/kit-miao/DM-JH11-51_101-2EC',
        description: ''
    },
    {
        name: 'DM-JH11-101-2EC',
        armature: 0.0000063,
        velocity: 3.142,
        effort: 10.5,
        url: 'https://gitee.com/kit-miao/DM-JH11-51_101-2EC',
        description: 'DM Harmonic Motor Controlled by CAN Protocol'
    },
    {
        name: 'DM-D5730 -1EC',
        armature: 0.0006,
        velocity: 157.08,
        effort: 1.9,
        url: 'https://gitee.com/kit-miao/dm-D5730-1-ec',
        description: 'DM Direct drive Motor Controlled by CAN Protocol'
    }
],
  'ENCOS': [
    {
        name: 'EC-A4310-P2-36',
        armature: 0.024747721,
        velocity: 9.32,
        effort: 36,
        url: 'http://encos.cn/productinfo/57543.html',
        description: 'Motor for EC-A4310-P2-36.'
    },
    {
        name: 'EC-A4310-P2-36H',
        armature: 0.024747721,
        velocity: 9.32,
        effort: 36,
        url: 'http://encos.cn/productinfo/55390.html',
        description: 'Motor for EC-A4310-P2-36H.'
    },
    {
        name: 'EC-A4315-P2-36',
        armature: 0.032749593,
        velocity: 12.25,
        effort: 75,
        url: 'http://encos.cn/productinfo/55373.html',
        description: 'Motor for EC-A4315-P2-36.'
    },
    {
        name: 'EC-A6408-P2-25',
        armature: 0.039354611,
        velocity: 15.60,
        effort: 60,
        url: 'http://encos.cn/productinfo/55372.html',
        description: 'Motor for EC-A6408-P2-25.'
    },
    {
        name: 'EC-A6408-P2-30.25H',
        armature: 0.058421541,
        velocity: 13.40,
        effort: 70,
        url: 'http://encos.cn/productinfo/55391.html',
        description: 'Motor for EC-A6408-P2-30.25H.'
    },
    {
        name: 'EC-A6416-P2-25',
        armature: 0.065785221,
        velocity: 12.57,
        effort: 120,
        url: 'http://encos.cn/productinfo/57096.html',
        description: 'Motor for EC-A6416-P2-25.'
    },
    {
        name: 'EC-A8112-P1-18',
        armature: 0.048486568,
        velocity: 16.44,
        effort: 90,
        url: 'http://encos.cn/productinfo/57074.html',
        description: 'Motor for EC-A8112-P1-18.'
    },
    {
        name: 'EC-A8112-P1-18H',
        armature: 0.051079588,
        velocity: 16.44,
        effort: 90,
        url: 'http://encos.cn/productinfo/57102.html',
        description: 'Motor for EC-A8112-P1-18H.'
    },
    {
        name: 'EC-A8116-P1-18',
        armature: 0.061446568,
        velocity: 14.66,
        effort: 130,
        url: 'http://encos.cn/productinfo/57098.html',
        description: 'Motor for EC-A8116-P1-18.'
    },
    {
        name: 'EC-A8116-P1-18H',
        armature: 0.064039572,
        velocity: 14.66,
        effort: 130,
        url: 'http://encos.cn/productinfo/57103.html',
        description: 'Motor for EC-A8116-P1-18H.'
    },
    {
        name: 'EC-A10020-P1-12',
        armature: 0.069946997,
        velocity: 14.66,
        effort: 150,
        url: 'http://encos.cn/productinfo/57076.html',
        description: 'Motor for EC-A10020-P1-12.'
    },
    {
        name: 'EC-A10020-P2-24',
        armature: 0.277528863,
        velocity: 12.88,
        effort: 330,
        url: 'http://encos.cn/productinfo/57105.html',
        description: 'Motor for EC-A10020-P2-24.'
    },
    {
        name: 'EC-A13715-P1-12.67',
        armature: 0.199180767,
        velocity: 14.14,
        effort: 320,
        url: 'http://encos.cn/productinfo/57100.html',
        description: 'Motor for EC-A13715-P1-12.67.'
    },
    {
        name: 'EC-A13720-P1-11.4',
        armature: 0.19737784,
        velocity: 14.55,
        effort: 400,
        url: 'http://encos.cn/productinfo/57101.html',
        description: 'Motor for EC-A13720-P1-11.4.'
    }
],
  'High Torque': [
    {
        name: 'HTDW-3532-02-DNE',
        armature: 0.0001,
        velocity: 300,
        effort: 3.7,
        url: 'https://www.hightorque.cn/',
        description: 'Mini Pi gripper and head.'
    },
    {
        name: 'HTDW-4530-02-DNE',
        armature: 0.0001,
        velocity: 160,
        effort: 10,
        url: 'https://www.hightorque.cn/product?id=467',
        description: 'arms and three-degree-of-freedom waist of Mini Pi .'
    },
    {
        name: 'HTDW-5047-36-NE',
        armature: 0.0001,
        velocity: 60,
        effort: 21,
        url: 'https://www.hightorque.cn/product?id=309',
        description: 'The legs of Mini Pi and the arms of Mini Hi.'
    },
   {
        name: 'HTDW-5036-02-DNE',
        armature: 0.0001,
        velocity: 75,
        effort: 21,
        url: 'https://www.hightorque.cn/',
        description: 'The legs of Mini Pi and the arms of Mini Hi.'
    },
   {
        name: 'HTDW-6036-02-DNE',
        armature: 0.0001,
        velocity: 60,
        effort: 36,
        url: 'https://www.hightorque.cn/product?id=941',
        description: 'Mini Hi legs and a single-degree-of-freedom waist.'
    },
   {
        name: 'HTDW-7535-02-CNE',
        armature: 0.0001,
        velocity: 60,
        effort: 60,
        url: 'https://www.hightorque.cn/product?id=1380',
        description: 'Applied to robotic arms.'
    },
   {
        name: 'HTPU-6035-04-CNE',
        armature: 0.0001,
        velocity: 60,
        effort: 36,
        url: 'https://www.hightorque.cn/product?id=1762',
        description: 'Applied in the field of robotic manipulators.'
    },
   {
        name: 'HTCP-5031-06-CYC',
        armature: 0.0001,
        velocity: 75,
        effort: 14,
        url: 'https://www.hightorque.cn/',
        description: 'Mini Pi Hollow Wiring Waist.'
    }]
};
