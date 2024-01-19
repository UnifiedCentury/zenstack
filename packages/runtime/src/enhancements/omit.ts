/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { enumerate, getModelFields, resolveField, type ModelMeta } from '../cross';
import { DbClientContract } from '../types';
import { EnhancementOptions } from './create-enhancement';
import { DefaultPrismaProxyHandler, makeProxy } from './proxy';

/**
 * Gets an enhanced Prisma client that supports `@omit` attribute.
 *
 * @private
 */
export function withOmit<DbClient extends object>(prisma: DbClient, options: EnhancementOptions): DbClient {
    return makeProxy(
        prisma,
        options.modelMeta,
        (_prisma, model) => new OmitHandler(_prisma as DbClientContract, model, options),
        'omit'
    );
}

class OmitHandler extends DefaultPrismaProxyHandler {
    constructor(prisma: DbClientContract, model: string, options: EnhancementOptions) {
        super(prisma, model, options);
    }

    // base override
    protected async processResultEntity<T>(data: T): Promise<T> {
        if (data) {
            for (const value of enumerate(data)) {
                await this.doPostProcess(value, this.model);
            }
        }
        return data;
    }

    private async doPostProcess(entityData: any, model: string) {
        for (const field of getModelFields(entityData)) {
            const fieldInfo = await resolveField(this.options.modelMeta, model, field);
            if (!fieldInfo) {
                continue;
            }

            if (fieldInfo.attributes?.find((attr) => attr.name === '@omit')) {
                delete entityData[field];
            } else if (fieldInfo.isDataModel) {
                // recurse
                await this.doPostProcess(entityData[field], fieldInfo.type);
            }
        }
    }
}
