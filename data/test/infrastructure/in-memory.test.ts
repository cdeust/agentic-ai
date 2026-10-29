import { InMemoryDataStore } from '../../src/infrastructure/in-memory.js';
import { dataStoreContract } from '../contracts/data-store.js';

dataStoreContract('in-memory', () => new InMemoryDataStore());
