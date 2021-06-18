const whyIsNodeRunning = require('why-is-node-running') // should be your first require
const { expect } = require('chai');
const { Bridge } = require('../bridge');
const { PromiseUtils } = require('@handy-common-utils/promise-utils');
const Faye = require('faye');

Faye.logger = console;

const bridge = new Bridge();

describe('Bridge', () => {
  it('can start and then stop', async function() {
    this.timeout(600000);
    console.log('================ reload() ================')
    await bridge.reload();
    const status = bridge.status();
    // console.log(status);
    expect(status).to.be.not.null;
    const channels = Object.keys(status);
    expect(channels.length).to.be.gt(0);
    await PromiseUtils.delayedResolve(5000);
    console.log('================ stopAll() ================')
    await bridge.stopAll();
  });

  it('can handle reload abuse', async function() {
    this.timeout(600000);
    console.log('================ reload() ================')
    await bridge.reload();
    const status = bridge.status();
    // console.log(status);
    expect(status).to.be.not.null;
    const channels = Object.keys(status);
    expect(channels.length).to.be.gt(0);
    for (let i = 0; i < 18; i ++) {
      await PromiseUtils.delayedResolve(1000 - i * 70);
      console.log('================ reload() ================')
      await bridge.reload();
    }
    console.log('================ stopAll() ================')
    await bridge.stopAll();
  });
});