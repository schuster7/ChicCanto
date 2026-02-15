import { bootLanding } from './landing.js';
import { bootRedeem } from './redeem.js';
import { bootPreview } from './preview.js';
import { bootTools } from './tools.js';
import { bootCard } from './card.js';
import { bootFulfill } from './fulfill.js';

const page = document.body.dataset.page;

if (page === 'landing') bootLanding();

if (page === 'redeem') bootRedeem();
if (page === 'preview') bootPreview();
if (page === 'tools') bootTools();
if (page === 'card') bootCard();
if (page === 'fulfill') bootFulfill();
