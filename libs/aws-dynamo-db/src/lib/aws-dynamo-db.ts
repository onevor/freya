import { DynamoDB } from 'aws-sdk';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

export enum VisitorOperation {
  GET = 'GET',
}

export type Visitor = (
  operation: VisitorOperation,
  data: VisitorData,
  params: VisitorParams
) => Promise<void>;

export type VisitorData = Record<string, any>;
export type VisitorParams = Record<string, any> | null;

export class Dynamo {
  protected docClient: DynamoDB.DocumentClient;
  protected visitors: Visitor[];

  name: string;
  region: string;
  hashKey: string;
  rangeKey: string;
  tableName: string;

  constructor(config: any) {
    this.name = config.name;
    this.region = config.region;
    this.hashKey = config.hashKey;
    this.rangeKey = config.rangeKey;
    this.tableName = config.tableName;

    this.docClient = new DocumentClient({
      region: this.region,
    });
  }

  protected async execVisitors(
    operation: VisitorOperation,
    data: VisitorData,
    params: VisitorParams
  ) {
    const visitorPromises: Promise<void>[] = [];

    this.visitors.forEach((visitor: Visitor) => {
      visitorPromises.push(visitor.call(this, operation, data, params));
    });

    try {
      // TODO: Might need to do this more efficiently later;
      await Promise.all(visitorPromises);
    } catch (error) {
      // Visitors should fail silently
      // It is up to the caller to handle the visitor errors.
      console.log('Failed to execute visitors', error);
    }
  }

  protected async paginate(
    params: DocumentClient.QueryInput
  ): Promise<Record<string, any>[]> {
    const docs: Record<string, any>[] = [];
    const paramsCopy = { ...params };

    do {
      const result = await this.docClient.query(paramsCopy).promise();
      docs.push(...result.Items);
      paramsCopy.ExclusiveStartKey = result.LastEvaluatedKey;
    } while (typeof paramsCopy.ExclusiveStartKey !== 'undefined');

    return docs;
  }

  protected getRangeKeyQuery(query: Record<string, any>) {
    const value = this.rangeKey ? query[this.rangeKey] : null;

    if (value) {
      return {
        [this.rangeKey]: value,
      };
    }
    return {};
  }

  async tryRequest(params: any, fn: string) {
    console.log(fn);
    console.log(typeof fn);
    try {
      // const result = await fn(params).promise();
      const result = await this.docClient[fn](params).promise();
      return [null, result];
    } catch (error) {
      return [error, null];
    }
  }

  async tryGet(params: DocumentClient.GetItemInput) {
    return this.tryRequest(params, 'get');
  }

  async tryBatchGet(params: DocumentClient.BatchGetItemInput) {
    return this.tryRequest(params, 'batchGet');
  }

  async tryPut(params: DocumentClient.PutItemInput) {
    return this.tryRequest(params, 'put');
  }

  async tryDelete(params: DocumentClient.DeleteItemInput) {
    return this.tryRequest(params, 'delete');
  }

  async get(query: Record<string, any>) {
    const rangeQ = this.getRangeKeyQuery(query);
    const params = {
      TableName: this.tableName,
      Key: {
        [this.hashKey]: query[this.hashKey],
        ...rangeQ,
      },
    };

    // TODO: visitor pre get here

    const [error, result] = await this.tryGet(params);
    if (error) {
      console.error('Failed to get item: ', error);
      return [error, null];
    }

    // TODO: visitor post get here

    const resultValue = result && result.Item ? result.Item : null;
    return [null, resultValue];
  }

  async batchGet(queries: Record<string, any>[]) {
    const params = {
      RequestItems: {
        [this.tableName]: {
          Keys: [],
        },
      },
    };

    const queriesParsed = queries.map((query) => {
      const hashVal = query[this.hashKey];
      const rangeQ = this.getRangeKeyQuery(query);
      return {
        [this.hashKey]: hashVal,
        ...rangeQ,
      };
    });

    params.RequestItems[this.tableName].Keys = queriesParsed;

    // TODO: visitor pre batch get here
    const [error, result] = await this.tryBatchGet(params);
    // TODO: visitor post batch get here
    if (error) {
      console.error('Failed to batch get items: ', error);
      return [error, null];
    }

    const resultValue =
      result && result.Responses && result.Responses[this.tableName]
        ? result.Responses[this.tableName]
        : [];
    return [null, resultValue];
  }

  async put(data: Record<string, any>, returnOld = false) {
    const params = {
      TableName: this.tableName,
      Item: data,
      ReturnValues: 'ALL_OLD',
    };

    // TODO: visitor pre put here
    const [error, result] = await this.tryPut(params);
    // TODO: visitor post put here
    if (error) {
      console.error('Failed to put item: ', error);
      return [error, null];
    }

    const existing = result?.Attributes || null;
    const isNew = !existing;

    if (isNew) return [null, data];

    return returnOld ? [null, existing] : [null, null];
  }

  async delete(query: Record<string, any>) {
    const hashVal = query[this.hashKey];
    const rangeQ = this.getRangeKeyQuery(query);

    const params = {
      TableName: this.tableName,
      Key: {
        [this.hashKey]: hashVal,
        ...rangeQ,
      },
      ReturnValues: 'ALL_OLD',
    };

    // TODO: visitor pre delete here
    const [error, result] = await this.tryDelete(params);
    // TODO: visitor post delete here
    if (error) {
      console.error('Failed to delete item: ', error);
      return [error, null];
    }

    return [null, result?.Attributes || null];
  }
}
