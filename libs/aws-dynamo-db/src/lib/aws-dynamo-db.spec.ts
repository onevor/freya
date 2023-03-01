import { awsDynamoDb } from './aws-dynamo-db';

describe('awsDynamoDb', () => {
  it('should work', () => {
    expect(awsDynamoDb()).toEqual('aws-dynamo-db');
  });
});
